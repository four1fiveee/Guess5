import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { enhancedLogger } from '../utils/enhancedLogger';
import { PublicKey } from '@solana/web3.js';
import { buildInitialProposalState, applyProposalStateToMatch } from '../utils/proposalSigners';

/**
 * Service to handle expired proposals and create refunds
 */
export class ProposalExpirationService {
  private readonly PROPOSAL_EXPIRATION_MINUTES = 30; // 30 minutes expiration

  /**
   * Scan for expired proposals and process them
   */
  async scanForExpiredProposals(): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const now = new Date();
      const expirationTime = new Date(now.getTime() - this.PROPOSAL_EXPIRATION_MINUTES * 60 * 1000);
      
      // Find ACTIVE proposals older than 30 minutes
      // CRITICAL: Use raw SQL to avoid proposalExpiresAt and executionAttempts column issues
      const expiredProposalRows = await matchRepository.query(`
        SELECT id, "proposalStatus", "proposalCreatedAt", "proposalExpiresAt", 
               "proposalSigners", "needsSignatures", "squadsVaultAddress", "squadsVaultPda",
               winner, "player1Result", "player2Result", "entryFee", player1, player2
        FROM "match"
        WHERE "proposalStatus" = $1
          AND "proposalCreatedAt" IS NOT NULL
          AND "proposalCreatedAt" < $2
          AND ("proposalExpiresAt" IS NULL OR "proposalExpiresAt" < $3)
      `, ['ACTIVE', expirationTime, now]);
      
      // Convert rows to Match entities
      const expiredProposals = expiredProposalRows.map((row: any) => {
        const match = new Match();
        match.id = row.id;
        match.proposalStatus = row.proposalStatus;
        match.proposalCreatedAt = row.proposalCreatedAt;
        match.proposalExpiresAt = row.proposalExpiresAt;
        match.proposalSigners = row.proposalSigners;
        match.needsSignatures = row.needsSignatures;
        match.squadsVaultAddress = row.squadsVaultAddress;
        match.squadsVaultPda = row.squadsVaultPda;
        match.winner = row.winner;
        match.player1Result = row.player1Result;
        match.player2Result = row.player2Result;
        match.entryFee = row.entryFee;
        match.player1 = row.player1;
        match.player2 = row.player2;
        return match;
      });

      enhancedLogger.info(`🔍 Found ${expiredProposals.length} expired proposals to process`);

      for (const match of expiredProposals) {
        try {
          await this.processExpiredProposal(match);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          enhancedLogger.error(`❌ Error processing expired proposal for match ${match.id}:`, {
            matchId: match.id,
            error: errorMessage
          });
        }
      }
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error scanning for expired proposals:', error);
    }
  }

  /**
   * Process a single expired proposal
   */
  private async processExpiredProposal(match: Match): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      
      // Reload match to get latest state
      const freshMatch = await matchRepository.findOne({ where: { id: match.id } });
      if (!freshMatch) {
        enhancedLogger.warn(`⚠️ Match ${match.id} not found, skipping`);
        return;
      }

      // Check if proposal has been signed or executed since scan
      if (freshMatch.proposalStatus !== 'ACTIVE' || freshMatch.needsSignatures === 0) {
        enhancedLogger.info(`⏭️ Match ${match.id} proposal no longer active, skipping`);
        return;
      }

      // Check if any signatures were collected
      const proposalSigners = freshMatch.proposalSigners 
        ? JSON.parse(freshMatch.proposalSigners) 
        : [];
      
      if (proposalSigners.length > 0) {
        enhancedLogger.info(`⏭️ Match ${match.id} has signatures collected, not creating refund`);
        // Mark as expired but don't create refund if signatures exist
        freshMatch.proposalStatus = 'EXPIRED';
        await matchRepository.save(freshMatch);
        return;
      }

      // No signatures collected - create refund proposal
      enhancedLogger.info(`⏳ Creating refund proposal for expired match ${match.id}`, {
        matchId: match.id,
        proposalId: freshMatch.payoutProposalId || freshMatch.tieRefundProposalId,
        proposalCreatedAt: freshMatch.proposalCreatedAt
      });

      // Determine refund type based on match outcome
      if (freshMatch.winner === 'tie') {
        await this.createTieRefund(freshMatch);
      } else {
        // For winner matches, refund both players their entry fees
        await this.createFullRefund(freshMatch);
      }

      // Mark proposal as expired
      freshMatch.proposalStatus = 'EXPIRED';
      freshMatch.proposalExpiresAt = new Date();
      await matchRepository.save(freshMatch);

      enhancedLogger.info(`✅ Processed expired proposal for match ${match.id}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error(`❌ Error processing expired proposal:`, {
        matchId: match.id,
        error: errorMessage
      });
      throw error;
    }
  }

  /**
   * Create tie refund proposal for expired match
   */
  private async createTieRefund(match: Match): Promise<void> {
    if (!match.squadsVaultAddress) {
      enhancedLogger.error(`❌ No vault address for match ${match.id}, cannot create refund`);
      return;
    }

    const entryFee = match.entryFee;
    const refundAmount = entryFee * 0.95; // 95% refund for losing tie

    // Acquire distributed lock to prevent race conditions
    const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
    const lockAcquired = await getProposalLock(match.id);
    
    if (!lockAcquired) {
      enhancedLogger.warn('⚠️ Proposal lock not acquired (expired tie refund), another process may be creating proposal', { matchId: match.id });
      // Reload match to check if proposal was created
      const { AppDataSource } = require('../db');
      const matchRepository = AppDataSource.getRepository(Match);
      const reloadedMatch = await matchRepository.findOne({ where: { id: match.id } });
      if (reloadedMatch && (reloadedMatch.payoutProposalId || reloadedMatch.tieRefundProposalId)) {
        enhancedLogger.info('✅ Proposal was created by another process (expired tie refund)', { matchId: match.id });
        return;
      }
    }

    try {
      // Double-check proposal still doesn't exist after acquiring lock
      const { AppDataSource } = require('../db');
      const matchRepository = AppDataSource.getRepository(Match);
      const checkMatch = await matchRepository.findOne({ where: { id: match.id } });
      if (checkMatch && (checkMatch.payoutProposalId || checkMatch.tieRefundProposalId)) {
        enhancedLogger.info('✅ Proposal already exists (expired tie refund), skipping creation', { matchId: match.id });
        return;
      }
      
      // Lazy require to avoid circular dependency issues
      const { squadsVaultService } = require('./squadsVaultService');
      
      // Use proposeTieRefund to refund both players
      const refundProposal = await squadsVaultService.proposeTieRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player1),
        new PublicKey(match.player2),
        refundAmount,
        match.squadsVaultPda ?? undefined
      );

      if (refundProposal.success && refundProposal.proposalId) {
        const proposalState = buildInitialProposalState(refundProposal.needsSignatures);
        match.payoutProposalId = refundProposal.proposalId;
        match.tieRefundProposalId = refundProposal.proposalId;
        match.proposalCreatedAt = new Date();
        match.proposalStatus = 'ACTIVE';
        applyProposalStateToMatch(match, proposalState);
        await matchRepository.save(match);

        enhancedLogger.info(`✅ Created tie refund proposal for expired match`, {
          matchId: match.id,
          proposalId: refundProposal.proposalId,
          needsSignatures: proposalState.normalizedNeeds,
          signers: proposalState.signers,
        });
      } else {
        enhancedLogger.error(`❌ Failed to create tie refund proposal:`, {
          matchId: match.id,
          error: refundProposal.error
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error(`❌ Error creating tie refund for expired match:`, {
        matchId: match.id,
        error: errorMessage
      });
    } finally {
      if (lockAcquired) {
        await releaseProposalLock(match.id);
      }
    }
  }

  /**
   * Create full refund for both players (expired winner match)
   */
  private async createFullRefund(match: Match): Promise<void> {
    if (!match.squadsVaultAddress) {
      enhancedLogger.error(`❌ No vault address for match ${match.id}, cannot create refund`);
      return;
    }

    const entryFee = match.entryFee;

    // Acquire distributed lock to prevent race conditions
    const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
    const lockAcquired = await getProposalLock(match.id);
    
    if (!lockAcquired) {
      enhancedLogger.warn('⚠️ Proposal lock not acquired (expired full refund), another process may be creating proposal', { matchId: match.id });
      // Reload match to check if proposal was created
      const { AppDataSource } = require('../db');
      const matchRepository = AppDataSource.getRepository(Match);
      const reloadedMatch = await matchRepository.findOne({ where: { id: match.id } });
      if (reloadedMatch && (reloadedMatch.payoutProposalId || reloadedMatch.tieRefundProposalId)) {
        enhancedLogger.info('✅ Proposal was created by another process (expired full refund)', { matchId: match.id });
        return;
      }
    }

    try {
      // Double-check proposal still doesn't exist after acquiring lock
      const { AppDataSource } = require('../db');
      const matchRepository = AppDataSource.getRepository(Match);
      const checkMatch = await matchRepository.findOne({ where: { id: match.id } });
      if (checkMatch && (checkMatch.payoutProposalId || checkMatch.tieRefundProposalId)) {
        enhancedLogger.info('✅ Proposal already exists (expired full refund), skipping creation', { matchId: match.id });
        return;
      }
      
      // Lazy require to avoid circular dependency issues
      const { squadsVaultService } = require('./squadsVaultService');
      
      // Use proposeTieRefund to refund both players their full entry fees
      // Note: proposeTieRefund refunds both players, so we use entryFee as the refund amount
      const refundProposal = await squadsVaultService.proposeTieRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player1),
        new PublicKey(match.player2),
        entryFee, // Each player gets this amount back
        match.squadsVaultPda ?? undefined
      );

      if (refundProposal.success && refundProposal.proposalId) {
        const proposalState = buildInitialProposalState(refundProposal.needsSignatures);
        match.payoutProposalId = refundProposal.proposalId;
        match.tieRefundProposalId = refundProposal.proposalId;
        match.proposalCreatedAt = new Date();
        match.proposalStatus = 'ACTIVE';
        applyProposalStateToMatch(match, proposalState);
        await matchRepository.save(match);

        enhancedLogger.info(`✅ Created full refund proposal for expired match`, {
          matchId: match.id,
          proposalId: refundProposal.proposalId,
          needsSignatures: proposalState.normalizedNeeds,
          signers: proposalState.signers,
        });
      } else {
        enhancedLogger.error(`❌ Failed to create full refund proposal:`, {
          matchId: match.id,
          error: refundProposal.error
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error(`❌ Error creating full refund for expired match:`, {
        matchId: match.id,
        error: errorMessage
      });
    } finally {
      if (lockAcquired) {
        await releaseProposalLock(match.id);
      }
    }
  }

  /**
   * Set proposal expiration timestamp when proposal is created
   */
  setProposalExpiration(match: Match): void {
    if (match.proposalCreatedAt) {
      match.proposalExpiresAt = new Date(
        new Date(match.proposalCreatedAt).getTime() + this.PROPOSAL_EXPIRATION_MINUTES * 60 * 1000
      );
      enhancedLogger.info(`⏰ Set proposal expiration for match ${match.id}`, {
        matchId: match.id,
        expiresAt: match.proposalExpiresAt.toISOString()
      });
    }
  }

  /**
   * Check if proposal is expired
   */
  isProposalExpired(match: Match): boolean {
    if (!match.proposalExpiresAt) {
      return false;
    }
    return new Date() > new Date(match.proposalExpiresAt);
  }
}

// Export singleton instance - matches pattern used by timeoutScannerService and squadsVaultService
export const proposalExpirationService = new ProposalExpirationService();

import { AppDataSource } from '../db/index';
import { Match } from '../models/Match';
import { enhancedLogger } from '../utils/enhancedLogger';
import { squadsVaultService } from './squadsVaultService';
import { PublicKey } from '@solana/web3.js';

const FEE_WALLET_ADDRESS = process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

/**
 * Service to handle expired proposals and create refunds
 */
class ProposalExpirationService {
  private readonly PROPOSAL_EXPIRATION_MINUTES = 30; // 30 minutes expiration

  /**
   * Scan for expired proposals and process them
   */
  async scanForExpiredProposals(): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const now = new Date();
      
      // Find ACTIVE proposals older than 30 minutes
      const expiredProposals = await matchRepository
        .createQueryBuilder('match')
        .where('match.proposalStatus = :status', { status: 'ACTIVE' })
        .andWhere('match.proposalCreatedAt IS NOT NULL')
        .andWhere('match.proposalCreatedAt < :expirationTime', {
          expirationTime: new Date(now.getTime() - this.PROPOSAL_EXPIRATION_MINUTES * 60 * 1000)
        })
        .andWhere('(match.proposalExpiresAt IS NULL OR match.proposalExpiresAt < :now)', { now })
        .getMany();

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

    try {
      // Create refund proposal for player 1
      const player1Refund = await squadsVaultService.proposeRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player1),
        refundAmount
      );

      if (player1Refund.success) {
        enhancedLogger.info(`✅ Created refund proposal for player 1 (expired match)`, {
          matchId: match.id,
          proposalId: player1Refund.proposalId
        });
      }

      // Create refund proposal for player 2
      const player2Refund = await squadsVaultService.proposeRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player2),
        refundAmount
      );

      if (player2Refund.success) {
        enhancedLogger.info(`✅ Created refund proposal for player 2 (expired match)`, {
          matchId: match.id,
          proposalId: player2Refund.proposalId
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error(`❌ Error creating tie refund for expired match:`, {
        matchId: match.id,
        error: errorMessage
      });
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

    try {
      // Refund both players their full entry fees
      const player1Refund = await squadsVaultService.proposeRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player1),
        entryFee
      );

      if (player1Refund.success) {
        enhancedLogger.info(`✅ Created full refund proposal for player 1 (expired match)`, {
          matchId: match.id,
          proposalId: player1Refund.proposalId
        });
      }

      const player2Refund = await squadsVaultService.proposeRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player2),
        entryFee
      );

      if (player2Refund.success) {
        enhancedLogger.info(`✅ Created full refund proposal for player 2 (expired match)`, {
          matchId: match.id,
          proposalId: player2Refund.proposalId
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error(`❌ Error creating full refund for expired match:`, {
        matchId: match.id,
        error: errorMessage
      });
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

// Export singleton instance
export const proposalExpirationService = new ProposalExpirationService();


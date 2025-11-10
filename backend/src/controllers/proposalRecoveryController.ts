import { Match } from '../models/Match';
import { SquadsVaultService } from '../services/squadsVaultService';
import { PublicKey } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';
import { AppDataSource } from '../db';
import { buildInitialProposalState, applyProposalStateToMatch, normalizeRequiredSignatures } from '../utils/proposalSigners';

/**
 * Ensure proposals are created for completed matches
 * This is a recovery function to fix matches that ended without proposals
 * Also used automatically when matches complete
 */
export const ensureProposalsForMatch = async (match: Match): Promise<void> => {
  try {
    // Skip if proposal already exists
    if ((match as any).payoutProposalId || (match as any).tieRefundProposalId) {
      return;
    }

    // Skip if match is not completed
    if (!match.isCompleted) {
      return;
    }

    // Skip if no vault address
    if (!match.squadsVaultAddress) {
      enhancedLogger.warn('⚠️ Cannot create proposal: missing vault address', {
        matchId: match.id,
      });
      return;
    }

    const squadsService = new SquadsVaultService();
    const player1Result = match.getPlayer1Result();
    const player2Result = match.getPlayer2Result();
    const isLosingTie = match.winner === 'tie' && 
                        player1Result && 
                        player2Result && 
                        !player1Result.won && 
                        !player2Result.won;

    if (match.winner && match.winner !== 'tie') {
      // Winner payout proposal
      const winner = match.winner;
      const entryFee = match.entryFee;
      const totalPot = entryFee * 2;
      const winnerAmount = totalPot * 0.95;
      const feeAmount = totalPot * 0.05;

      enhancedLogger.info('🔄 Creating missing winner payout proposal', {
        matchId: match.id,
        winner,
        winnerAmount,
      });

      const proposalResult = await squadsService.proposeWinnerPayout(
        match.squadsVaultAddress,
        new PublicKey(winner),
        winnerAmount,
        new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
    feeAmount,
    match.squadsVaultPda ?? undefined
      );

      if (proposalResult.success && proposalResult.proposalId) {
        const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
        (match as any).payoutProposalId = proposalResult.proposalId;
        (match as any).proposalCreatedAt = new Date();
        (match as any).proposalStatus = 'ACTIVE';
        applyProposalStateToMatch(match, proposalState);
        
        // Save match with proposal ID
        const matchRepository = AppDataSource.getRepository(Match);
        await matchRepository.save(match);
        
        enhancedLogger.info('✅ Winner payout proposal created and saved', {
          matchId: match.id,
          proposalId: proposalResult.proposalId,
          needsSignatures: proposalState.normalizedNeeds,
          signers: proposalState.signers,
        });
      } else {
        enhancedLogger.error('❌ Failed to create winner payout proposal', {
          matchId: match.id,
          error: proposalResult.error,
        });
      }
    } else if (isLosingTie) {
      // Tie refund proposal
      const entryFee = match.entryFee;
      const refundAmount = entryFee * 0.95;

      enhancedLogger.info('🔄 Creating missing tie refund proposal', {
        matchId: match.id,
        player1: match.player1,
        player2: match.player2,
        refundAmount,
      });

      const proposalResult = await squadsService.proposeTieRefund(
        match.squadsVaultAddress,
        new PublicKey(match.player1),
        new PublicKey(match.player2),
    refundAmount,
    match.squadsVaultPda ?? undefined
      );

      if (proposalResult.success && proposalResult.proposalId) {
        const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
        (match as any).payoutProposalId = proposalResult.proposalId;
        (match as any).tieRefundProposalId = proposalResult.proposalId;
        (match as any).proposalCreatedAt = new Date();
        (match as any).proposalStatus = 'ACTIVE';
        applyProposalStateToMatch(match, proposalState);
        
        // Save match with proposal ID
        const matchRepository = AppDataSource.getRepository(Match);
        await matchRepository.save(match);
        
        enhancedLogger.info('✅ Tie refund proposal created and saved', {
          matchId: match.id,
          proposalId: proposalResult.proposalId,
          needsSignatures: proposalState.normalizedNeeds,
          signers: proposalState.signers,
        });
      } else {
        enhancedLogger.error('❌ Failed to create tie refund proposal', {
          matchId: match.id,
          error: proposalResult.error,
        });
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error ensuring proposals for match', {
      matchId: match.id,
      error: errorMessage,
    });
  }
};


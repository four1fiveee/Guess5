import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { ensureProposalsForMatch } from '../controllers/proposalRecoveryController';
import { enhancedLogger } from '../utils/enhancedLogger';

/**
 * Automatically create proposals when a match completes
 * Call this function after setting match.isCompleted = true
 */
export async function autoCreateProposalsForMatch(matchId: string): Promise<void> {
  try {
    enhancedLogger.info('🔄 Auto-creating proposals for completed match', { matchId });
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      enhancedLogger.warn('⚠️ Match not found for auto-proposal creation', { matchId });
      return;
    }
    
    if (!match.isCompleted) {
      enhancedLogger.warn('⚠️ Match is not completed yet, skipping proposal creation', { matchId });
      return;
    }
    
    // Check if proposal already exists
    if ((match as any).payoutProposalId || (match as any).tieRefundProposalId) {
      enhancedLogger.info('✅ Proposal already exists for match', {
        matchId,
        payoutProposalId: (match as any).payoutProposalId,
        tieRefundProposalId: (match as any).tieRefundProposalId,
      });
      return;
    }
    
    // Ensure proposals are created
    await ensureProposalsForMatch(match);
    
    enhancedLogger.info('✅ Auto-proposal creation completed', { matchId });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Failed to auto-create proposals for match', {
      matchId,
      error: errorMessage,
    });
    // Don't throw - this is a background operation
  }
}

/**
 * Hook to be called after match.save() when isCompleted changes to true
 * This can be used in a database hook or called manually after match completion
 * Call this function whenever you set match.isCompleted = true and save the match
 */
export async function onMatchCompleted(match: Match): Promise<void> {
  if (match.isCompleted && !match.squadsVaultAddress) {
    enhancedLogger.warn('⚠️ Match completed but no vault address, skipping proposal creation', {
      matchId: match.id,
    });
    return;
  }
  
  if (match.isCompleted) {
    // Check if proposal already exists to avoid duplicate creation
    if ((match as any).payoutProposalId || (match as any).tieRefundProposalId) {
      enhancedLogger.info('✅ Proposal already exists, skipping auto-creation', {
        matchId: match.id,
        payoutProposalId: (match as any).payoutProposalId,
        tieRefundProposalId: (match as any).tieRefundProposalId,
      });
      return;
    }
    
    await autoCreateProposalsForMatch(match.id);
  }
}

/**
 * Helper function to complete a match and automatically create proposals
 * Use this instead of manually setting isCompleted = true
 */
export async function completeMatchAndCreateProposals(matchId: string, winner: string | 'tie'): Promise<void> {
  try {
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }
    
    // Set match as completed
    match.isCompleted = true;
    match.winner = winner;
    
    // Save match
    await matchRepository.save(match);
    
    enhancedLogger.info('✅ Match marked as completed', {
      matchId,
      winner,
    });
    
    // Automatically create proposals
    await onMatchCompleted(match);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Failed to complete match and create proposals', {
      matchId,
      error: errorMessage,
    });
    throw error;
  }
}


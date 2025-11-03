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

    await ensureProposalsForMatch(match);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error auto-creating proposals for match', {
      matchId,
      error: errorMessage,
    });
  }
}

/**
 * Hook to be called when a match is completed
 * Checks if proposals already exist and creates them if needed
 */
export async function onMatchCompleted(match: Match): Promise<void> {
  if (match.isCompleted && !match.squadsVaultAddress) {
    enhancedLogger.warn('⚠️ Match completed but no vault address, skipping proposal creation', {
      matchId: match.id,
    });
    return;
  }
  
  if (match.isCompleted) {
    // Check if proposals already exist
    if ((match as any).payoutProposalId || (match as any).tieRefundProposalId) {
      enhancedLogger.info('✅ Proposal already exists, skipping auto-creation', {
        matchId: match.id,
        payoutProposalId: (match as any).payoutProposalId,
        tieRefundProposalId: (match as any).tieRefundProposalId,
      });
      return;
    }
    
    // Trigger proposal creation
    await autoCreateProposalsForMatch(match.id);
  }
}

/**
 * Helper to complete a match and automatically create proposals
 */
export async function completeMatchAndCreateProposals(matchId: string, winner: string | 'tie'): Promise<void> {
  try {
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      enhancedLogger.warn('⚠️ Match not found for completion', { matchId });
      return;
    }

    const wasCompletedBefore = match.isCompleted;
    match.isCompleted = true;
    match.winner = winner;
    
    await matchRepository.save(match);
    
    // Trigger proposal creation if match was just completed
    if (!wasCompletedBefore) {
      await onMatchCompleted(match);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error completing match and creating proposals', {
      matchId,
      error: errorMessage,
    });
  }
}


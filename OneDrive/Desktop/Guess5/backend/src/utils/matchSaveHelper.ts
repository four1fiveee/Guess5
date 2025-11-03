import { Repository } from 'typeorm';
import { Match } from '../models/Match';
import { onMatchCompleted } from '../services/proposalAutoCreateService';
import { enhancedLogger } from '../utils/enhancedLogger';

/**
 * Helper function to save a match and automatically trigger proposal creation
 * if the match is completed. Use this instead of matchRepository.save(match)
 * to ensure proposals are automatically created.
 */
export async function saveMatchAndTriggerProposals(
  matchRepository: Repository<Match>,
  match: Match,
  wasCompletedBefore?: boolean
): Promise<Match> {
  // Check if match was completed before saving
  const wasCompleted = wasCompletedBefore !== undefined ? wasCompletedBefore : match.isCompleted;
  
  // Save the match
  const savedMatch = await matchRepository.save(match);
  
  // If match is now completed and wasn't before, trigger proposal creation
  if (savedMatch.isCompleted && !wasCompleted) {
    enhancedLogger.info('🎯 Match completed, triggering proposal creation via save helper', {
      matchId: savedMatch.id,
      winner: savedMatch.winner,
    });
    
    // Trigger proposal creation asynchronously (don't block the save)
    onMatchCompleted(savedMatch).catch((error) => {
      enhancedLogger.error('❌ Failed to auto-create proposals via save helper', {
        matchId: savedMatch.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  
  return savedMatch;
}
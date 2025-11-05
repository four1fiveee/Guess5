import { EventSubscriber, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { Match } from '../models/Match';
import { onMatchCompleted } from '../services/proposalAutoCreateService';
import { enhancedLogger } from '../utils/enhancedLogger';

/**
 * TypeORM subscriber that automatically triggers proposal creation
 * when a match is marked as completed
 */
@EventSubscriber()
export class MatchSubscriber implements EntitySubscriberInterface<Match> {
  listenTo() {
    return Match;
  }

  /**
   * Called after a match entity is updated
   * Automatically creates proposals when isCompleted changes to true
   */
  async afterUpdate(event: UpdateEvent<Match>) {
    const match = event.entity as Match;
    
    if (!match) {
      return;
    }

    // Check if isCompleted changed from false to true
    const wasCompletedBefore = event.databaseEntity?.isCompleted || false;
    const isCompletedNow = match.isCompleted || false;

    if (!wasCompletedBefore && isCompletedNow) {
      enhancedLogger.info('🎯 Match completed detected, triggering proposal creation', {
        matchId: match.id,
        winner: match.winner,
      });

      // Trigger proposal creation asynchronously (don't block the save)
      onMatchCompleted(match).catch((error) => {
        enhancedLogger.error('❌ Failed to auto-create proposals via subscriber', {
          matchId: match.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}



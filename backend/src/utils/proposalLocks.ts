import { getRedisMM } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

/**
 * Distributed locking utility for proposal creation to prevent race conditions
 */
export const getProposalLock = async (matchId: string): Promise<boolean> => {
  try {
    const redis = getRedisMM();
    const lockKey = `proposal:lock:${matchId}`;
    
    // Try to acquire lock with SET NX (set if not exists)
    // This is atomic and prevents race conditions
    const result = await redis.setNX(lockKey, '1');
    
    if (result) {
      // Lock acquired - set expiration to 60 seconds (proposal creation should be fast)
      await redis.expire(lockKey, 60);
      enhancedLogger.info(`✅ Proposal lock acquired for match ${matchId}`);
      return true;
    }
    
    // Lock already exists - another process is creating proposal
    enhancedLogger.warn(`⚠️ Proposal lock already exists for match ${matchId}`);
    return false;
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error acquiring proposal lock for match ${matchId}:`, error);
    // Fail open - allow proposal creation if lock check fails
    return true;
  }
};

export const releaseProposalLock = async (matchId: string): Promise<void> => {
  try {
    const redis = getRedisMM();
    const lockKey = `proposal:lock:${matchId}`;
    await redis.del(lockKey);
    enhancedLogger.info(`✅ Proposal lock released for match ${matchId}`);
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error releasing proposal lock for match ${matchId}:`, error);
    // Don't throw - lock release is best effort
  }
};


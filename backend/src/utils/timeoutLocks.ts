import { getRedisMM } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

/**
 * Distributed locking utility for timeout processing to prevent race conditions
 */
export const getTimeoutLock = async (matchId: string): Promise<boolean> => {
  try {
    const redis = getRedisMM();
    const lockKey = `timeout:lock:${matchId}`;
    
    // Try to acquire lock with SET NX (set if not exists)
    // This is atomic and prevents race conditions
    const result = await redis.setNX(lockKey, '1');
    
    if (result) {
      // Lock acquired - set expiration to 5 minutes
      await redis.expire(lockKey, 300);
      enhancedLogger.info(`✅ Timeout lock acquired for match ${matchId}`);
      return true;
    }
    
    // Lock already exists - another process is handling this timeout
    enhancedLogger.warn(`⚠️ Timeout lock already exists for match ${matchId}`);
    return false;
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error acquiring timeout lock for match ${matchId}:`, error);
    // Fail open - allow timeout processing if lock check fails
    return true;
  }
};

export const releaseTimeoutLock = async (matchId: string): Promise<void> => {
  try {
    const redis = getRedisMM();
    const lockKey = `timeout:lock:${matchId}`;
    await redis.del(lockKey);
    enhancedLogger.info(`✅ Timeout lock released for match ${matchId}`);
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error releasing timeout lock for match ${matchId}:`, error);
    // Don't throw - lock release is best effort
  }
};


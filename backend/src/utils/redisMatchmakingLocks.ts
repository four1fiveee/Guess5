import { getRedisMM } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

export interface MatchmakingLock {
  wallet: string;
  timestamp: number;
  entryFee: number;
}

export const getMatchmakingLock = async (lockKey: string): Promise<MatchmakingLock | null> => {
  try {
    const redis = getRedisMM();
    const lockJson = await redis.hGet(`lock:${lockKey}`, 'data');
    if (!lockJson) {
      return null;
    }
    return JSON.parse(lockJson) as MatchmakingLock;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error getting matchmaking lock from Redis:', error);
    return null;
  }
};

export const setMatchmakingLock = async (lockKey: string, lock: MatchmakingLock): Promise<void> => {
  try {
    const redis = getRedisMM();
    await redis.hSet(`lock:${lockKey}`, 'data', JSON.stringify(lock));
    await redis.expire(`lock:${lockKey}`, 30); // 30 seconds TTL - shorter to prevent blocking
    enhancedLogger.info(`✅ Matchmaking lock set in Redis: ${lockKey}`);
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error setting matchmaking lock in Redis:', error);
    throw error;
  }
};

export const deleteMatchmakingLock = async (lockKey: string): Promise<void> => {
  try {
    const redis = getRedisMM();
    await redis.del(`lock:${lockKey}`);
    enhancedLogger.info(`✅ Matchmaking lock deleted from Redis: ${lockKey}`);
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error deleting matchmaking lock from Redis:', error);
    throw error;
  }
};

export const getAllMatchmakingLocks = async (): Promise<Array<[string, MatchmakingLock]>> => {
  try {
    const redis = getRedisMM();
    const keys = await redis.keys('lock:*');
    const locks: Array<[string, MatchmakingLock]> = [];
    
    for (const key of keys) {
      const lockKey = key.replace('lock:', '');
      const lock = await getMatchmakingLock(lockKey);
      if (lock) {
        locks.push([lockKey, lock]);
      }
    }
    
    return locks;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error getting all matchmaking locks from Redis:', error);
    return [];
  }
};

export const cleanupExpiredMatchmakingLocks = async (): Promise<number> => {
  try {
    const redis = getRedisMM();
    const keys = await redis.keys('lock:*');
    let cleanedCount = 0;
    
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) { // No expiration set
        await redis.expire(key, 300); // Set 5 minutes TTL
        cleanedCount++;
      }
    }
    
    enhancedLogger.info(`✅ Cleaned up ${cleanedCount} matchmaking locks in Redis`);
    return cleanedCount;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error cleaning up matchmaking locks in Redis:', error);
    return 0;
  }
};

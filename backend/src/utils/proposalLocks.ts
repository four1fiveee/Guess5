import { getRedisMM } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

/**
 * Distributed locking utility for proposal creation to prevent race conditions
 * ENHANCED VERSION with automatic cleanup and monitoring
 */

// Track active locks for monitoring
const activeLocks = new Map<string, { timestamp: number; processId: string }>();
const LOCK_TIMEOUT_MS = 120000; // 2 minutes max lock time
const LOCK_EXPIRY_SECONDS = 120; // Redis expiry (backup)

/**
 * Acquire a proposal lock with enhanced reliability
 */
export const getProposalLock = async (matchId: string): Promise<boolean> => {
  try {
    const redis = getRedisMM();
    const lockKey = `proposal:lock:${matchId}`;
    const processId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const lockValue = JSON.stringify({
      processId,
      timestamp: Date.now(),
      matchId
    });
    
    // Try to acquire lock with SET NX EX (atomic set if not exists with expiration)
    const result = await redis.set(lockKey, lockValue, {
      NX: true, // Only set if key doesn't exist
      EX: LOCK_EXPIRY_SECONDS // Expire after 2 minutes
    });
    
    if (result === 'OK') {
      // Lock acquired successfully
      activeLocks.set(matchId, { timestamp: Date.now(), processId });
      enhancedLogger.info(`✅ Proposal lock acquired for match ${matchId}`, {
        processId,
        lockKey,
        expirySeconds: LOCK_EXPIRY_SECONDS
      });
      return true;
    }
    
    // Lock already exists - check if it's stale
    try {
      const existingLock = await redis.get(lockKey);
      if (existingLock) {
        const lockData = JSON.parse(existingLock);
        const lockAge = Date.now() - lockData.timestamp;
        
        if (lockAge > LOCK_TIMEOUT_MS) {
          // Lock is stale - force release and retry
          enhancedLogger.warn(`🔧 Forcing release of stale lock for match ${matchId}`, {
            lockAge: `${Math.round(lockAge / 1000)}s`,
            staleLockProcessId: lockData.processId
          });
          
          await forceReleaseLock(matchId);
          
          // Retry acquisition once
          const retryResult = await redis.set(lockKey, lockValue, {
            NX: true,
            EX: LOCK_EXPIRY_SECONDS
          });
          
          if (retryResult === 'OK') {
            activeLocks.set(matchId, { timestamp: Date.now(), processId });
            enhancedLogger.info(`✅ Proposal lock acquired after stale cleanup for match ${matchId}`, {
              processId
            });
            return true;
          }
        }
      }
    } catch (parseError) {
      enhancedLogger.warn(`⚠️ Could not parse existing lock data for match ${matchId}`, parseError);
    }
    
    // Lock still exists and is not stale
    enhancedLogger.warn(`⚠️ Proposal lock already exists for match ${matchId}`);
    return false;
    
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error acquiring proposal lock for match ${matchId}:`, error);
    // Fail open - allow proposal creation if lock check fails
    return true;
  }
};

/**
 * Release a proposal lock with verification
 */
export const releaseProposalLock = async (matchId: string): Promise<void> => {
  try {
    const redis = getRedisMM();
    const lockKey = `proposal:lock:${matchId}`;
    
    // Get current lock to verify ownership (optional - for logging)
    let currentProcessId = 'unknown';
    try {
      const existingLock = await redis.get(lockKey);
      if (existingLock) {
        const lockData = JSON.parse(existingLock);
        currentProcessId = lockData.processId;
      }
    } catch (parseError) {
      // Ignore parse errors - still try to delete
    }
    
    // Delete the lock
    const result = await redis.del(lockKey);
    
    // Remove from active tracking
    activeLocks.delete(matchId);
    
    if (result > 0) {
      enhancedLogger.info(`✅ Proposal lock released for match ${matchId}`, {
        processId: currentProcessId,
        lockKey
      });
    } else {
      enhancedLogger.warn(`⚠️ Proposal lock was already released for match ${matchId}`, {
        processId: currentProcessId
      });
    }
    
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error releasing proposal lock for match ${matchId}:`, error);
    // Don't throw - lock release is best effort
    // But still remove from tracking
    activeLocks.delete(matchId);
  }
};

/**
 * Force release a lock (for cleanup/admin purposes)
 */
export const forceReleaseLock = async (matchId: string): Promise<boolean> => {
  try {
    const redis = getRedisMM();
    const lockKey = `proposal:lock:${matchId}`;
    
    const result = await redis.del(lockKey);
    activeLocks.delete(matchId);
    
    enhancedLogger.info(`🔧 Force released proposal lock for match ${matchId}`, {
      lockKey,
      keysDeleted: result
    });
    
    return result > 0;
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error force releasing proposal lock for match ${matchId}:`, error);
    return false;
  }
};

/**
 * Check if a lock exists and get its details
 */
export const checkLockStatus = async (matchId: string): Promise<{
  exists: boolean;
  age?: number;
  processId?: string;
  isStale?: boolean;
}> => {
  try {
    const redis = getRedisMM();
    const lockKey = `proposal:lock:${matchId}`;
    
    const lockValue = await redis.get(lockKey);
    if (!lockValue) {
      return { exists: false };
    }
    
    try {
      const lockData = JSON.parse(lockValue);
      const age = Date.now() - lockData.timestamp;
      const isStale = age > LOCK_TIMEOUT_MS;
      
      return {
        exists: true,
        age,
        processId: lockData.processId,
        isStale
      };
    } catch (parseError) {
      return {
        exists: true,
        isStale: true // Treat unparseable locks as stale
      };
    }
  } catch (error: unknown) {
    enhancedLogger.error(`❌ Error checking lock status for match ${matchId}:`, error);
    return { exists: false };
  }
};

/**
 * Cleanup stale locks (called periodically)
 */
export const cleanupStaleLocks = async (): Promise<number> => {
  let cleanedCount = 0;
  
  try {
    const redis = getRedisMM();
    
    // Get all proposal locks
    const lockKeys = await redis.keys('proposal:lock:*');
    
    for (const lockKey of lockKeys) {
      try {
        const lockValue = await redis.get(lockKey);
        if (!lockValue) continue;
        
        const lockData = JSON.parse(lockValue);
        const age = Date.now() - lockData.timestamp;
        
        if (age > LOCK_TIMEOUT_MS) {
          const matchId = lockKey.replace('proposal:lock:', '');
          await forceReleaseLock(matchId);
          cleanedCount++;
          
          enhancedLogger.info(`🧹 Cleaned up stale lock for match ${matchId}`, {
            age: `${Math.round(age / 1000)}s`,
            processId: lockData.processId
          });
        }
      } catch (parseError) {
        // If we can't parse the lock, it's probably corrupted - delete it
        const matchId = lockKey.replace('proposal:lock:', '');
        await redis.del(lockKey);
        cleanedCount++;
        
        enhancedLogger.info(`🧹 Cleaned up corrupted lock for match ${matchId}`);
      }
    }
    
    if (cleanedCount > 0) {
      enhancedLogger.info(`🧹 Cleanup completed: ${cleanedCount} stale locks removed`);
    }
    
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error during lock cleanup:', error);
  }
  
  return cleanedCount;
};

/**
 * Get statistics about active locks
 */
export const getLockStats = async (): Promise<{
  totalLocks: number;
  staleLocks: number;
  activeLocks: number;
}> => {
  try {
    const redis = getRedisMM();
    const lockKeys = await redis.keys('proposal:lock:*');
    
    let staleLocks = 0;
    let activeLocks = 0;
    
    for (const lockKey of lockKeys) {
      try {
        const lockValue = await redis.get(lockKey);
        if (!lockValue) continue;
        
        const lockData = JSON.parse(lockValue);
        const age = Date.now() - lockData.timestamp;
        
        if (age > LOCK_TIMEOUT_MS) {
          staleLocks++;
        } else {
          activeLocks++;
        }
      } catch (parseError) {
        staleLocks++; // Treat unparseable as stale
      }
    }
    
    return {
      totalLocks: lockKeys.length,
      staleLocks,
      activeLocks
    };
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error getting lock stats:', error);
    return { totalLocks: 0, staleLocks: 0, activeLocks: 0 };
  }
};

// Auto-cleanup interval reference
let autoCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize auto-cleanup (call after Redis is ready)
 */
export const initializeAutoCleanup = (): void => {
  if (autoCleanupInterval) {
    enhancedLogger.warn('⚠️ Auto-cleanup already initialized');
    return;
  }
  
  // Start auto-cleanup every 5 minutes
  autoCleanupInterval = setInterval(async () => {
    try {
      await cleanupStaleLocks();
    } catch (error) {
      enhancedLogger.error('❌ Auto-cleanup failed:', error);
    }
  }, 5 * 60 * 1000);
  
  enhancedLogger.info('✅ Auto-cleanup initialized (5-minute intervals)');
};

/**
 * Stop auto-cleanup (for graceful shutdown)
 */
export const stopAutoCleanup = (): void => {
  if (autoCleanupInterval) {
    clearInterval(autoCleanupInterval);
    autoCleanupInterval = null;
    enhancedLogger.info('🛑 Auto-cleanup stopped');
  }
};


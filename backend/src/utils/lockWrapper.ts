import { getProposalLock, releaseProposalLock } from './proposalLocks';
import { enhancedLogger } from './enhancedLogger';

/**
 * Robust lock wrapper that GUARANTEES lock release
 * This prevents the Redis lock stuck issue by ensuring cleanup in ALL scenarios
 */
export async function withProposalLock<T>(
  matchId: string,
  operation: () => Promise<T>,
  operationName: string = 'operation'
): Promise<T | null> {
  let lockAcquired = false;
  
  try {
    // Attempt to acquire lock
    lockAcquired = await getProposalLock(matchId);
    
    if (!lockAcquired) {
      enhancedLogger.warn(`⚠️ Proposal lock not acquired for ${operationName}`, {
        matchId,
        reason: 'Another process may be creating proposal'
      });
      return null;
    }
    
    enhancedLogger.info(`🔒 Executing ${operationName} with lock for match ${matchId}`);
    
    // Execute the operation
    const result = await operation();
    
    enhancedLogger.info(`✅ ${operationName} completed successfully for match ${matchId}`);
    return result;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error(`❌ ${operationName} failed for match ${matchId}:`, {
      error: errorMessage,
      lockAcquired
    });
    
    // Re-throw the error after cleanup
    throw error;
    
  } finally {
    // CRITICAL: Always release lock if it was acquired
    if (lockAcquired) {
      try {
        await releaseProposalLock(matchId);
        enhancedLogger.info(`🔓 Lock released after ${operationName} for match ${matchId}`);
      } catch (releaseError: unknown) {
        const releaseErrorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
        enhancedLogger.error(`❌ CRITICAL: Failed to release lock after ${operationName} for match ${matchId}:`, {
          error: releaseErrorMessage,
          note: 'This could cause future lock conflicts'
        });
      }
    }
  }
}

/**
 * Alternative lock wrapper that returns a boolean success indicator
 */
export async function tryWithProposalLock(
  matchId: string,
  operation: () => Promise<void>,
  operationName: string = 'operation'
): Promise<boolean> {
  try {
    const result = await withProposalLock(matchId, operation, operationName);
    return result !== null;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error(`❌ ${operationName} failed with lock for match ${matchId}:`, {
      error: errorMessage
    });
    return false;
  }
}

/**
 * Lock wrapper with timeout protection
 */
export async function withProposalLockTimeout<T>(
  matchId: string,
  operation: () => Promise<T>,
  timeoutMs: number = 60000, // 1 minute default
  operationName: string = 'operation'
): Promise<T | null> {
  return new Promise(async (resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null = null;
    let completed = false;
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        enhancedLogger.error(`⏰ ${operationName} timed out after ${timeoutMs}ms for match ${matchId}`);
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    
    try {
      const result = await withProposalLock(matchId, operation, operationName);
      
      if (!completed) {
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(result);
      }
    } catch (error) {
      if (!completed) {
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      }
    }
  });
}

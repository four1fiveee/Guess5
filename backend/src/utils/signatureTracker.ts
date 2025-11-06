import { getRedisMM } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

/**
 * Global signature tracking utility to prevent replay attacks and duplicate payments
 */
class SignatureTracker {
  private redis: ReturnType<typeof getRedisMM> | null = null;
  private initialized = false;

  private async ensureInitialized() {
    if (this.initialized && this.redis) return;

    try {
      this.redis = getRedisMM();
      this.initialized = true;
      enhancedLogger.info('✅ Signature tracker initialized successfully');
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error initializing signature tracker:', error);
      throw error;
    }
  }

  /**
   * Check if a signature has been used before
   * @param signature Transaction signature to check
   * @param matchId Optional match ID to check signature per-match
   * @returns true if signature is unique, false if already used
   */
  async isSignatureUnique(signature: string, matchId?: string): Promise<boolean> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      // Check global signature set
      const globalKey = `signature:${signature}`;
      const exists = await this.redis.exists(globalKey);
      
      if (exists) {
        enhancedLogger.warn('⚠️ Signature already used globally', { signature, matchId });
        return false;
      }

      // If matchId provided, also check per-match uniqueness
      if (matchId) {
        const matchKey = `signature:match:${matchId}:${signature}`;
        const matchExists = await this.redis.exists(matchKey);
        
        if (matchExists) {
          enhancedLogger.warn('⚠️ Signature already used for this match', { signature, matchId });
          return false;
        }
      }

      return true;
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error checking signature uniqueness:', error);
      // Fail open - allow signature if we can't check (prevents blocking valid payments)
      return true;
    }
  }

  /**
   * Mark a signature as used
   * @param signature Transaction signature to mark
   * @param matchId Optional match ID for per-match tracking
   */
  async markSignatureUsed(signature: string, matchId?: string): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      // Store in global signature set with 24 hour TTL
      const globalKey = `signature:${signature}`;
      await this.redis.setEx(globalKey, 86400, '1'); // 24 hours

      // If matchId provided, also store per-match
      if (matchId) {
        const matchKey = `signature:match:${matchId}:${signature}`;
        await this.redis.setEx(matchKey, 86400, '1'); // 24 hours
      }

      enhancedLogger.info('✅ Signature marked as used', { signature, matchId });
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error marking signature as used:', error);
      // Don't throw - signature tracking is best effort
    }
  }

  /**
   * Clean up old signatures (called by background job)
   */
  async cleanupOldSignatures(): Promise<number> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        return 0;
      }

      // Redis TTL handles cleanup automatically, but we can also manually clean
      // by checking for keys that are about to expire
      const signatureKeys = await this.redis.keys('signature:*');
      let cleaned = 0;

      for (const key of signatureKeys) {
        const ttl = await this.redis.ttl(key);
        if (ttl < 0) {
          // Key expired or doesn't exist
          await this.redis.del(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        enhancedLogger.info(`🧹 Cleaned up ${cleaned} expired signature tracking entries`);
      }

      return cleaned;
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error cleaning up old signatures:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const signatureTracker = new SignatureTracker();


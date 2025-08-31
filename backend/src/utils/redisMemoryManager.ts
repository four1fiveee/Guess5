import { getRedisOps } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

// Redis-based memory management for 1000 concurrent users
export class RedisMemoryManager {
  private static instance: RedisMemoryManager;
  private redis: any;

  private constructor() {
    this.redis = getRedisOps();
  }

  public static getInstance(): RedisMemoryManager {
    if (!RedisMemoryManager.instance) {
      RedisMemoryManager.instance = new RedisMemoryManager();
    }
    return RedisMemoryManager.instance;
  }

  // Memory limits for 1000 concurrent users
  private readonly MAX_ACTIVE_GAMES = 1000;
  private readonly MAX_MATCHMAKING_LOCKS = 500;
  private readonly MAX_IN_MEMORY_MATCHES = 100;

  // Memory monitoring
  private async getMemoryStats() {
    try {
      const stats = await this.redis.mGet([
        'memory:activeGames',
        'memory:matchmakingLocks', 
        'memory:inMemoryMatches',
        'memory:lastCleanup'
      ]);

      return {
        activeGames: parseInt(stats[0] || '0'),
        matchmakingLocks: parseInt(stats[1] || '0'),
        inMemoryMatches: parseInt(stats[2] || '0'),
        lastCleanup: parseInt(stats[3] || Date.now().toString())
      };
    } catch (error) {
      enhancedLogger.error('❌ Error getting memory stats:', error);
      return {
        activeGames: 0,
        matchmakingLocks: 0,
        inMemoryMatches: 0,
        lastCleanup: Date.now()
      };
    }
  }

  // Check memory limits
  public async checkMemoryLimits(): Promise<{
    activeGames: number;
    matchmakingLocks: number;
    inMemoryMatches: number;
    warnings: string[];
  }> {
    const stats = await this.getMemoryStats();
    const warnings: string[] = [];

    // Check limits and log warnings
    if (stats.activeGames > this.MAX_ACTIVE_GAMES * 0.8) {
      warnings.push(`High active games count: ${stats.activeGames}/${this.MAX_ACTIVE_GAMES}`);
    }
    
    if (stats.matchmakingLocks > this.MAX_MATCHMAKING_LOCKS * 0.8) {
      warnings.push(`High matchmaking locks count: ${stats.matchmakingLocks}/${this.MAX_MATCHMAKING_LOCKS}`);
    }
    
    if (stats.inMemoryMatches > this.MAX_IN_MEMORY_MATCHES * 0.8) {
      warnings.push(`High in-memory matches count: ${stats.inMemoryMatches}/${this.MAX_IN_MEMORY_MATCHES}`);
    }

    return {
      ...stats,
      warnings
    };
  }

  // Increment counters
  public async incrementCounter(counterType: 'activeGames' | 'matchmakingLocks' | 'inMemoryMatches'): Promise<void> {
    try {
      await this.redis.incr(`memory:${counterType}`);
    } catch (error) {
      enhancedLogger.error(`❌ Error incrementing ${counterType} counter:`, error);
    }
  }

  // Decrement counters
  public async decrementCounter(counterType: 'activeGames' | 'matchmakingLocks' | 'inMemoryMatches'): Promise<void> {
    try {
      await this.redis.decr(`memory:${counterType}`);
    } catch (error) {
      enhancedLogger.error(`❌ Error decrementing ${counterType} counter:`, error);
    }
  }

  // Cleanup inactive games
  public async cleanupInactiveGames(): Promise<{ cleanedGames: number; cleanedLocks: number }> {
    try {
      const now = Date.now();
      const inactiveTimeout = 10 * 60 * 1000; // 10 minutes
      const lockTimeout = 30 * 1000; // 30 seconds
      
      let cleanedGames = 0;
      let cleanedLocks = 0;

      // Get all active games
      const activeGameKeys = await this.redis.keys('activeGame:*');
      
      for (const key of activeGameKeys) {
        const gameData = await this.redis.get(key);
        if (gameData) {
          const game = JSON.parse(gameData);
          const timeSinceActivity = now - game.lastActivity;
          
          // Only clean up games that are truly inactive (not completed)
          if (!game.completed && timeSinceActivity > inactiveTimeout) {
            enhancedLogger.info(`🧹 Cleaning up inactive game: ${key}`);
            await this.redis.del(key);
            await this.decrementCounter('activeGames');
            cleanedGames++;
          }
        }
      }

      // Get all matchmaking locks
      const lockKeys = await this.redis.keys('matchmakingLock:*');
      
      for (const key of lockKeys) {
        const lockData = await this.redis.get(key);
        if (lockData) {
          const lock = JSON.parse(lockData);
          const timeSinceCreated = now - lock.createdAt;
          
          if (timeSinceCreated > lockTimeout) {
            enhancedLogger.info(`🧹 Cleaning up expired lock: ${key}`);
            await this.redis.del(key);
            await this.decrementCounter('matchmakingLocks');
            cleanedLocks++;
          }
        }
      }

      // Update last cleanup time
      await this.redis.set('memory:lastCleanup', now.toString());

      return { cleanedGames, cleanedLocks };
    } catch (error) {
      enhancedLogger.error('❌ Error during cleanup:', error);
      return { cleanedGames: 0, cleanedLocks: 0 };
    }
  }

  // Store active game data
  public async storeActiveGame(matchId: string, gameData: any): Promise<void> {
    try {
      const key = `activeGame:${matchId}`;
      await this.redis.setEx(key, 3600, JSON.stringify(gameData)); // 1 hour TTL
      await this.incrementCounter('activeGames');
    } catch (error) {
      enhancedLogger.error(`❌ Error storing active game ${matchId}:`, error);
    }
  }

  // Get active game data
  public async getActiveGame(matchId: string): Promise<any | null> {
    try {
      const key = `activeGame:${matchId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      enhancedLogger.error(`❌ Error getting active game ${matchId}:`, error);
      return null;
    }
  }

  // Remove active game
  public async removeActiveGame(matchId: string): Promise<void> {
    try {
      const key = `activeGame:${matchId}`;
      await this.redis.del(key);
      await this.decrementCounter('activeGames');
    } catch (error) {
      enhancedLogger.error(`❌ Error removing active game ${matchId}:`, error);
    }
  }

  // Store matchmaking lock
  public async storeMatchmakingLock(lockKey: string, lockData: any): Promise<void> {
    try {
      const key = `matchmakingLock:${lockKey}`;
      await this.redis.setEx(key, 300, JSON.stringify(lockData)); // 5 minutes TTL
      await this.incrementCounter('matchmakingLocks');
    } catch (error) {
      enhancedLogger.error(`❌ Error storing matchmaking lock ${lockKey}:`, error);
    }
  }

  // Get matchmaking lock
  public async getMatchmakingLock(lockKey: string): Promise<any | null> {
    try {
      const key = `matchmakingLock:${lockKey}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      enhancedLogger.error(`❌ Error getting matchmaking lock ${lockKey}:`, error);
      return null;
    }
  }

  // Remove matchmaking lock
  public async removeMatchmakingLock(lockKey: string): Promise<void> {
    try {
      const key = `matchmakingLock:${lockKey}`;
      await this.redis.del(key);
      await this.decrementCounter('matchmakingLocks');
    } catch (error) {
      enhancedLogger.error(`❌ Error removing matchmaking lock ${lockKey}:`, error);
    }
  }

  // Store in-memory match (for backward compatibility)
  public async storeInMemoryMatch(matchId: string, matchData: any): Promise<void> {
    try {
      const key = `inMemoryMatch:${matchId}`;
      await this.redis.setEx(key, 1800, JSON.stringify(matchData)); // 30 minutes TTL
      await this.incrementCounter('inMemoryMatches');
    } catch (error) {
      enhancedLogger.error(`❌ Error storing in-memory match ${matchId}:`, error);
    }
  }

  // Get in-memory match
  public async getInMemoryMatch(matchId: string): Promise<any | null> {
    try {
      const key = `inMemoryMatch:${matchId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      enhancedLogger.error(`❌ Error getting in-memory match ${matchId}:`, error);
      return null;
    }
  }

  // Remove in-memory match
  public async removeInMemoryMatch(matchId: string): Promise<void> {
    try {
      const key = `inMemoryMatch:${matchId}`;
      await this.redis.del(key);
      await this.decrementCounter('inMemoryMatches');
    } catch (error) {
      enhancedLogger.error(`❌ Error removing in-memory match ${matchId}:`, error);
    }
  }
}

// Export singleton instance
export const redisMemoryManager = RedisMemoryManager.getInstance();

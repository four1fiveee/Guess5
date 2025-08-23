import { getRedisMM } from '../config/redis';
import { enhancedLogger } from '../utils/enhancedLogger';

interface WaitingPlayer {
  wallet: string;
  entryFee: number;
  timestamp: number;
}

interface MatchData {
  matchId: string;
  player1: string;
  player2: string;
  entryFee: number;
  status: 'waiting' | 'payment_required' | 'active' | 'completed' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export class RedisMatchmakingService {
  private redis: ReturnType<typeof getRedisMM> | null = null;
  private initialized = false;

  constructor() {
    // Don't initialize immediately - wait for Redis to be ready
  }

  private async ensureInitialized() {
    if (this.initialized && this.redis) return;

    try {
      this.redis = getRedisMM();
      this.initialized = true;
      enhancedLogger.info('✅ Redis matchmaking service initialized successfully');
    } catch (error) {
      enhancedLogger.error('❌ Error initializing Redis matchmaking service:', error);
      throw error;
    }
  }

  async addPlayerToQueue(wallet: string, entryFee: number): Promise<{ status: 'waiting' | 'matched'; matchId?: string; waitingCount?: number }> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const waitingKey = `waiting:${entryFee}`;
      const playerData: WaitingPlayer = {
        wallet,
        entryFee,
        timestamp: Date.now()
      };

      // Check if there's already a waiting player with the same entry fee
      const waitingPlayers = await this.redis.hGetAll(waitingKey);
      
      if (Object.keys(waitingPlayers).length === 0) {
        // No waiting players, add this player to the queue
        await this.redis.hSet(waitingKey, wallet, JSON.stringify(playerData));
        await this.redis.expire(waitingKey, 300); // 5 minutes timeout
        
        enhancedLogger.info(`👤 Player ${wallet} added to waiting queue for ${entryFee} SOL`);
        return { status: 'waiting', waitingCount: 1 };
      } else {
        // Find a compatible player
        for (const [waitingWallet, playerJson] of Object.entries(waitingPlayers)) {
          if (waitingWallet === wallet) {
            // Player is already in queue
            return { status: 'waiting', waitingCount: Object.keys(waitingPlayers).length };
          }

          const waitingPlayer: WaitingPlayer = JSON.parse(playerJson);
          
          // Check if players are compatible (same entry fee, different wallets)
          if (waitingPlayer.entryFee === entryFee && waitingPlayer.wallet !== wallet) {
            // Create a match
            const matchId = `match:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
            const matchData: MatchData = {
              matchId,
              player1: waitingPlayer.wallet,
              player2: wallet,
              entryFee,
              status: 'payment_required',
              createdAt: Date.now(),
              expiresAt: Date.now() + 300000 // 5 minutes
            };

            // Store match data
            await this.redis.hSet(`match:${matchId}`, 'data', JSON.stringify(matchData));
            await this.redis.expire(`match:${matchId}`, 600); // 10 minutes

            // Store player associations
            await this.redis.hSet(`player:${waitingPlayer.wallet}`, 'matchId', matchId);
            await this.redis.hSet(`player:${wallet}`, 'matchId', matchId);
            await this.redis.expire(`player:${waitingPlayer.wallet}`, 600);
            await this.redis.expire(`player:${wallet}`, 600);

            // Remove waiting player from queue
            await this.redis.hDel(waitingKey, waitingPlayer.wallet);

            enhancedLogger.info(`🎯 Match created: ${matchId} between ${waitingPlayer.wallet} and ${wallet}`);
            return { status: 'matched', matchId };
          }
        }

        // No compatible player found, add to queue
        await this.redis.hSet(waitingKey, wallet, JSON.stringify(playerData));
        await this.redis.expire(waitingKey, 300);
        
        const waitingCount = Object.keys(waitingPlayers).length + 1;
        enhancedLogger.info(`👤 Player ${wallet} added to waiting queue for ${entryFee} SOL (${waitingCount} waiting)`);
        return { status: 'waiting', waitingCount };
      }
    } catch (error) {
      enhancedLogger.error('❌ Error adding player to queue:', error);
      throw error;
    }
  }

  async findMatch(wallet: string): Promise<MatchData | null> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

             const playerMatchId = await this.redis.hGet(`player:${wallet}`, 'matchId');
       if (!playerMatchId) {
         return null;
       }

       const matchDataJson = await this.redis.hGet(`match:${playerMatchId as string}`, 'data');
      if (!matchDataJson) {
        return null;
      }

      return JSON.parse(matchDataJson) as MatchData;
    } catch (error) {
      enhancedLogger.error('❌ Error finding match:', error);
      return null;
    }
  }

  async getMatch(matchId: string): Promise<MatchData | null> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const matchDataJson = await this.redis.hGet(`match:${matchId}`, 'data');
      if (!matchDataJson) {
        return null;
      }

      return JSON.parse(matchDataJson as string) as MatchData;
    } catch (error) {
      enhancedLogger.error('❌ Error getting match:', error);
      return null;
    }
  }

  async getPlayerMatch(wallet: string): Promise<MatchData | null> {
    return this.findMatch(wallet);
  }

  async updateMatchStatus(matchId: string, status: MatchData['status']): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const matchDataJson = await this.redis.hGet(`match:${matchId}`, 'data');
      if (!matchDataJson) {
        throw new Error(`Match ${matchId} not found`);
      }

      const matchData: MatchData = JSON.parse(matchDataJson);
      matchData.status = status;

      await this.redis.hSet(`match:${matchId}`, 'data', JSON.stringify(matchData));
      enhancedLogger.info(`🔄 Match ${matchId} status updated to: ${status}`);
    } catch (error) {
      enhancedLogger.error('❌ Error updating match status:', error);
      throw error;
    }
  }

  async removePlayerFromQueue(wallet: string, entryFee: number): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const waitingKey = `waiting:${entryFee}`;
      await this.redis.hDel(waitingKey, wallet);
      enhancedLogger.info(`👤 Player ${wallet} removed from waiting queue`);
    } catch (error) {
      enhancedLogger.error('❌ Error removing player from queue:', error);
      throw error;
    }
  }

  async getWaitingCount(entryFee: number): Promise<number> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const waitingKey = `waiting:${entryFee}`;
      const waitingCount = await this.redis.hLen(waitingKey);
      return waitingCount;
    } catch (error) {
      enhancedLogger.error('❌ Error getting waiting count:', error);
      return 0;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const now = Date.now();
      const waitingKeys = await this.redis.keys('waiting:*');
      
      for (const waitingKey of waitingKeys) {
        const waitingPlayers = await this.redis.hGetAll(waitingKey);
        
        for (const [wallet, playerJson] of Object.entries(waitingPlayers)) {
          const player: WaitingPlayer = JSON.parse(playerJson);
          
          // Remove players who have been waiting for more than 5 minutes
          if (now - player.timestamp > 300000) {
            await this.redis.hDel(waitingKey, wallet);
            enhancedLogger.info(`🧹 Cleaned up expired waiting player: ${wallet}`);
          }
        }
      }

      // Clean up expired matches
      const matchKeys = await this.redis.keys('match:*');
      for (const matchKey of matchKeys) {
                 const matchDataJson = await this.redis.hGet(matchKey, 'data');
         if (matchDataJson) {
           const matchData: MatchData = JSON.parse(matchDataJson as string);
          
          if (now > matchData.expiresAt) {
            await this.redis.del(matchKey);
            await this.redis.del(`player:${matchData.player1}`);
            await this.redis.del(`player:${matchData.player2}`);
            enhancedLogger.info(`🧹 Cleaned up expired match: ${matchData.matchId}`);
          }
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error during cleanup:', error);
    }
  }
}

// Export singleton instance
export const redisMatchmakingService = new RedisMatchmakingService();

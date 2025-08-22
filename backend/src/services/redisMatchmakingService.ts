import { getRedisMM } from '../config/redis';
import { enhancedLogger } from '../utils/enhancedLogger';

export interface MatchmakingPlayer {
  wallet: string;
  entryFee: number;
  timestamp: number;
  matchId?: string;
}

export interface Match {
  matchId: string;
  player1: string;
  player2: string;
  entryFee: number;
  status: 'waiting_payment' | 'active' | 'completed' | 'cancelled';
  createdAt: number;
  player1Paid?: boolean;
  player2Paid?: boolean;
}

export class RedisMatchmakingService {
  private redis: ReturnType<typeof getRedisMM> | null = null;
  
  // Key prefixes for Redis
  private readonly WAITING_PLAYERS_KEY = 'mm:waiting';
  private readonly MATCHES_KEY = 'mm:matches';
  private readonly PLAYER_MATCH_KEY = 'mm:player:';
  private readonly MATCH_EXPIRY = 300; // 5 minutes
  private readonly PLAYER_EXPIRY = 120; // 2 minutes
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

  /**
   * Add a player to the waiting queue
   */
  async addPlayerToQueue(wallet: string, entryFee: number): Promise<{ status: 'waiting' | 'matched'; matchId?: string; waitingCount?: number }> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const player: MatchmakingPlayer = {
        wallet,
        entryFee,
        timestamp: Date.now()
      };

      // Check if player is already in a match
      const existingMatch = await this.getPlayerMatch(wallet);
      if (existingMatch) {
        enhancedLogger.info(`🎯 Player ${wallet} already in match ${existingMatch.matchId}`);
        return { status: 'matched', matchId: existingMatch.matchId };
      }

      // Remove player from waiting queue if they exist
      await this.removePlayerFromQueue(wallet);

      // Add player to waiting queue
      await this.redis!.hset(this.WAITING_PLAYERS_KEY, wallet, JSON.stringify(player));
      await this.redis!.expire(this.WAITING_PLAYERS_KEY, this.PLAYER_EXPIRY);

      // Look for a matching player
      const match = await this.findMatch(wallet, entryFee);
      
      if (match) {
        // Create match
        const matchId = this.generateMatchId();
        const matchData: Match = {
          matchId,
          player1: match.player1,
          player2: wallet,
          entryFee,
          status: 'waiting_payment',
          createdAt: Date.now()
        };

        // Store match data
        await this.redis!.hset(this.MATCHES_KEY, matchId, JSON.stringify(matchData));
        await this.redis!.expire(`${this.MATCHES_KEY}:${matchId}`, this.MATCH_EXPIRY);

        // Update player records with match ID
        await this.redis!.hset(this.PLAYER_MATCH_KEY + match.player1, 'matchId', matchId);
        await this.redis!.hset(this.PLAYER_MATCH_KEY + wallet, 'matchId', matchId);
        await this.redis!.expire(this.PLAYER_MATCH_KEY + match.player1, this.MATCH_EXPIRY);
        await this.redis!.expire(this.PLAYER_MATCH_KEY + wallet, this.MATCH_EXPIRY);

        // Remove both players from waiting queue
        await this.removePlayerFromQueue(match.player1);
        await this.removePlayerFromQueue(wallet);

        enhancedLogger.info(`🎯 Match created: ${matchId} between ${match.player1} and ${wallet}`);
        return { status: 'matched', matchId };
      }

      // Get waiting count
      const waitingCount = await this.getWaitingCount();
      enhancedLogger.info(`⏳ Player ${wallet} added to waiting queue. Total waiting: ${waitingCount}`);
      
      return { status: 'waiting', waitingCount };
    } catch (error) {
      enhancedLogger.error('❌ Error adding player to queue:', error);
      throw error;
    }
  }

  /**
   * Find a matching player for the given wallet and entry fee
   */
  private async findMatch(wallet: string, entryFee: number): Promise<{ player1: string } | null> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const waitingPlayers = await this.redis.hgetall(this.WAITING_PLAYERS_KEY);
      
      for (const [waitingWallet, playerData] of Object.entries(waitingPlayers)) {
        if (waitingWallet === wallet) continue;
        
        const player: MatchmakingPlayer = JSON.parse(playerData);
        
        // Check if entry fees match
        if (player.entryFee === entryFee) {
          // Check if player is still valid (not expired)
          const age = Date.now() - player.timestamp;
          if (age < this.PLAYER_EXPIRY * 1000) {
            return { player1: waitingWallet };
          }
        }
      }
      
      return null;
    } catch (error) {
      enhancedLogger.error('❌ Error finding match:', error);
      return null;
    }
  }

  /**
   * Get match data by match ID
   */
  async getMatch(matchId: string): Promise<Match | null> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const matchData = await this.redis.hget(this.MATCHES_KEY, matchId);
      if (!matchData) return null;
      
      return JSON.parse(matchData);
    } catch (error) {
      enhancedLogger.error('❌ Error getting match:', error);
      return null;
    }
  }

  /**
   * Get player's current match
   */
  async getPlayerMatch(wallet: string): Promise<{ matchId: string } | null> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const matchId = await this.redis.hget(this.PLAYER_MATCH_KEY + wallet, 'matchId');
      if (!matchId) return null;
      
      return { matchId };
    } catch (error) {
      enhancedLogger.error('❌ Error getting player match:', error);
      return null;
    }
  }

  /**
   * Update match status
   */
  async updateMatchStatus(matchId: string, status: Match['status'], updates?: Partial<Match>): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const match = await this.getMatch(matchId);
      if (!match) {
        throw new Error(`Match ${matchId} not found`);
      }

      const updatedMatch = { ...match, status, ...updates };
      await this.redis.hset(this.MATCHES_KEY, matchId, JSON.stringify(updatedMatch));
      
      enhancedLogger.info(`🔄 Updated match ${matchId} status to ${status}`);
    } catch (error) {
      enhancedLogger.error('❌ Error updating match status:', error);
      throw error;
    }
  }

  /**
   * Remove player from waiting queue
   */
  async removePlayerFromQueue(wallet: string): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      await this.redis.hdel(this.WAITING_PLAYERS_KEY, wallet);
    } catch (error) {
      enhancedLogger.error('❌ Error removing player from queue:', error);
    }
  }

  /**
   * Get waiting count
   */
  async getWaitingCount(): Promise<number> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      return await this.redis.hlen(this.WAITING_PLAYERS_KEY);
    } catch (error) {
      enhancedLogger.error('❌ Error getting waiting count:', error);
      return 0;
    }
  }

  /**
   * Clean up expired data
   */
  async cleanup(): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const waitingPlayers = await this.redis.hgetall(this.WAITING_PLAYERS_KEY);
      const now = Date.now();
      
      for (const [wallet, playerData] of Object.entries(waitingPlayers)) {
        const player: MatchmakingPlayer = JSON.parse(playerData);
        const age = now - player.timestamp;
        
        if (age > this.PLAYER_EXPIRY * 1000) {
          await this.removePlayerFromQueue(wallet);
          enhancedLogger.info(`🧹 Cleaned up expired player: ${wallet}`);
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error during cleanup:', error);
    }
  }

  /**
   * Generate unique match ID
   */
  private generateMatchId(): string {
    return `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const redisMatchmakingService = new RedisMatchmakingService();

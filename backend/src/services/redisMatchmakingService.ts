import { getRedisMM } from '../config/redis';
import { enhancedLogger } from '../utils/enhancedLogger';
import { v4 as uuidv4 } from 'uuid';

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
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error initializing Redis matchmaking service:', error);
      throw error;
    }
  }

  private async cleanupOldEntriesForWallet(wallet: string): Promise<void> {
    try {
      if (!this.redis) return;

      // Remove this wallet from all waiting queues
      const waitingKeys = await this.redis.keys('waiting:*');
      for (const key of waitingKeys) {
        await this.redis.hDel(key, wallet);
        enhancedLogger.info(`🧹 Cleaned up old entry for wallet ${wallet} from queue ${key}`);
      }

      // Remove old player associations
      await this.redis.del(`player:${wallet}`);
      enhancedLogger.info(`🧹 Cleaned up old player association for wallet ${wallet}`);
    } catch (error: unknown) {
      enhancedLogger.error(`❌ Error cleaning up old entries for wallet ${wallet}:`, error);
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

      // Clean up any old entries for this wallet first
      await this.cleanupOldEntriesForWallet(wallet);

      // Check if there's already a waiting player with the same entry fee
      const waitingPlayers = await this.redis.hGetAll(waitingKey);
      
      if (Object.keys(waitingPlayers).length === 0) {
        // No waiting players, add this player to the queue
        await this.redis.hSet(waitingKey, wallet, JSON.stringify(playerData));
        await this.redis.expire(waitingKey, 600); // Increased from 300 to 600 seconds (10 minutes)
        
        enhancedLogger.info(`👤 Player ${wallet} added to waiting queue for ${entryFee} SOL`);
        return { status: 'waiting', waitingCount: 1 };
      } else {
        // Find a compatible player with flexible entry fee matching
        // Allow matching if entry fees are within 3% tolerance (to handle SOL price fluctuations)
        const ENTRY_FEE_TOLERANCE = 0.03; // 3% tolerance
        
        for (const [waitingWallet, playerJson] of Object.entries(waitingPlayers)) {
          // Double-check: never match with self
          if (waitingWallet === wallet) {
            enhancedLogger.warn(`🚫 Preventing self-match for wallet ${wallet} - removing old entry`);
            await this.redis.hDel(waitingKey, wallet);
            continue;
          }

          const waitingPlayer: WaitingPlayer = JSON.parse(playerJson as string);
          
          // Triple-check: ensure wallets are different
          if (waitingPlayer.wallet === wallet) {
            enhancedLogger.warn(`🚫 Preventing self-match for wallet ${wallet} - removing old entry`);
            await this.redis.hDel(waitingKey, wallet);
            continue;
          }
          
          // Check if players are compatible with flexible entry fee matching
          const feeDiff = Math.abs(waitingPlayer.entryFee - entryFee);
          const avgFee = (waitingPlayer.entryFee + entryFee) / 2;
          const feeTolerance = avgFee * ENTRY_FEE_TOLERANCE;
          const isCompatible = feeDiff <= feeTolerance && waitingPlayer.wallet !== wallet;
          
          if (isCompatible) {
            // Use the lower entry fee when matched (both players pay the same minimum amount)
            const finalEntryFee = Math.min(waitingPlayer.entryFee, entryFee);
            
            // Create a match with proper UUID
            const matchId = uuidv4();
            const matchData: MatchData = {
              matchId,
              player1: waitingPlayer.wallet,
              player2: wallet,
              entryFee: finalEntryFee, // Use the lower fee
              status: 'payment_required',
              createdAt: Date.now(),
              expiresAt: Date.now() + 1800000 // 30 minutes
            };

            // Store match data
            await this.redis.hSet(`match:${matchId}`, 'data', JSON.stringify(matchData));
            await this.redis.expire(`match:${matchId}`, 1800); // 30 minutes (already aligned with match expiration)

            // Store player associations
            await this.redis.hSet(`player:${waitingPlayer.wallet}`, 'matchId', matchId);
            await this.redis.hSet(`player:${wallet}`, 'matchId', matchId);
            await this.redis.expire(`player:${waitingPlayer.wallet}`, 1800); // 30 minutes (already aligned)
            await this.redis.expire(`player:${wallet}`, 1800); // 30 minutes (already aligned)
            
            // Add heartbeat mechanism: extend TTL when match is accessed
            // This ensures active matches don't expire prematurely
            await this.redis.hSet(`match:${matchId}`, 'lastAccess', Date.now().toString());

            // Remove waiting player from queue
            await this.redis.hDel(waitingKey, waitingPlayer.wallet);

            enhancedLogger.info(`🎯 Match created: ${matchId} between ${waitingPlayer.wallet} (${waitingPlayer.entryFee} SOL) and ${wallet} (${entryFee} SOL) using ${finalEntryFee} SOL`);
            return { status: 'matched', matchId };
          }
        }

        // No compatible player found, add to queue
        await this.redis.hSet(waitingKey, wallet, JSON.stringify(playerData));
        await this.redis.expire(waitingKey, 600); // Increased from 300 to 600 seconds (10 minutes)
        
        const waitingCount = Object.keys(waitingPlayers).length + 1;
        enhancedLogger.info(`👤 Player ${wallet} added to waiting queue for ${entryFee} SOL (${waitingCount} waiting)`);
        return { status: 'waiting', waitingCount };
      }
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error adding player to queue:', error);
      throw error;
    }
  }

  // Method to clear all matchmaking data (useful for testing)
  async clearAllMatchmakingData(): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      // Clear all waiting queues
      const waitingKeys = await this.redis.keys('waiting:*');
      for (const key of waitingKeys) {
        await this.redis.del(key);
        enhancedLogger.info(`🧹 Cleared waiting queue: ${key}`);
      }

      // Clear all match data
      const matchKeys = await this.redis.keys('match:*');
      for (const key of matchKeys) {
        await this.redis.del(key);
        enhancedLogger.info(`🧹 Cleared match data: ${key}`);
      }

      // Clear all player associations
      const playerKeys = await this.redis.keys('player:*');
      for (const key of playerKeys) {
        await this.redis.del(key);
        enhancedLogger.info(`🧹 Cleared player association: ${key}`);
      }

      enhancedLogger.info('✅ All Redis matchmaking data cleared');
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error clearing matchmaking data:', error);
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
    } catch (error: unknown) {
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
        // Match expired in Redis - try to recreate from database if needed
        enhancedLogger.warn(`⚠️ Match ${matchId} expired in Redis, may need to recreate from database`);
        return null;
      }

      // Heartbeat: Extend TTL when match is accessed (active match)
      await this.redis.hSet(`match:${matchId}`, 'lastAccess', Date.now().toString());
      await this.redis.expire(`match:${matchId}`, 1800); // Reset to 30 minutes

      return JSON.parse(matchDataJson as string) as MatchData;
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error getting match:', error);
      return null;
    }
  }

  async getPlayerMatch(wallet: string): Promise<MatchData | null> {
    const match = await this.findMatch(wallet);
    
    // Heartbeat: If match found, extend TTL
    if (match && this.redis) {
      try {
        await this.redis.hSet(`match:${match.matchId}`, 'lastAccess', Date.now().toString());
        await this.redis.expire(`match:${match.matchId}`, 1800); // Reset to 30 minutes
      } catch (error) {
        // Don't fail if heartbeat fails
        enhancedLogger.warn('⚠️ Failed to extend match TTL:', error);
      }
    }
    
    return match;
  }

  /**
   * Extend match expiration time to allow proposal creation to complete
   * CRITICAL: Call this when proposal creation starts to prevent premature expiration
   */
  async extendMatchExpirationForProposalCreation(matchId: string, additionalMinutes: number = 10): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const matchKey = `match:${matchId}`;
      const matchDataJson = await this.redis.hGet(matchKey, 'data');
      
      if (matchDataJson) {
        const matchData: MatchData = JSON.parse(matchDataJson as string);
        
        // Extend expiration time
        const newExpiresAt = Date.now() + (additionalMinutes * 60 * 1000);
        matchData.expiresAt = newExpiresAt;
        
        // Update match data with new expiration
        await this.redis.hSet(matchKey, 'data', JSON.stringify(matchData));
        
        // Extend Redis TTL (additionalMinutes + buffer for proposal creation)
        const ttlSeconds = (additionalMinutes + 2) * 60; // Add 2 minute buffer
        await this.redis.expire(matchKey, ttlSeconds);
        
        enhancedLogger.info(`⏰ Extended match expiration for proposal creation: ${matchId}`, {
          matchId,
          newExpiresAt: new Date(newExpiresAt).toISOString(),
          additionalMinutes,
          ttlSeconds
        });
      } else {
        enhancedLogger.warn(`⚠️ Could not extend expiration for match ${matchId} - match not found in Redis`);
      }
    } catch (error: unknown) {
      enhancedLogger.error(`❌ Error extending match expiration for ${matchId}:`, error);
      // Don't throw - this is a best-effort operation
    }
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
          const player: WaitingPlayer = JSON.parse(playerJson as string);
          
          // Remove players who have been waiting for more than 5 minutes
          if (now - player.timestamp > 300000) {
            await this.redis.hDel(waitingKey, wallet);
            enhancedLogger.info(`🧹 Cleaned up expired waiting player: ${wallet}`);
          }
        }
      }

      // Clean up expired matches
      // CRITICAL: Don't expire matches if proposal creation is pending or in progress
      const matchKeys = await this.redis.keys('match:*');
      for (const matchKey of matchKeys) {
        const matchDataJson = await this.redis.hGet(matchKey, 'data');
        if (matchDataJson) {
          const matchData: MatchData = JSON.parse(matchDataJson as string);
          
          if (now > matchData.expiresAt) {
            // CRITICAL: Check database to see if proposal creation is pending/in progress
            // Don't expire matches that need proposal creation
            try {
              const { AppDataSource } = require('../db/index');
              const { Match } = require('../db/entities/Match');
              const matchRepository = AppDataSource.getRepository(Match);
              
              const dbMatchRows = await matchRepository.query(`
                SELECT "proposalStatus", "isCompleted", "player1Result", "player2Result"
                FROM "match"
                WHERE id = $1
              `, [matchData.matchId]);
              
              if (dbMatchRows && dbMatchRows.length > 0) {
                const dbMatch = dbMatchRows[0];
                const bothPlayersHaveResults = !!dbMatch.player1Result && !!dbMatch.player2Result;
                const isCompleted = dbMatch.isCompleted;
                const proposalStatus = dbMatch.proposalStatus;
                
                // Don't expire if:
                // 1. Match is completed but proposal creation is pending/in progress
                // 2. Both players have results but no proposal exists yet (proposal creation should start)
                const shouldExpire = !(
                  (isCompleted || bothPlayersHaveResults) && 
                  (!proposalStatus || proposalStatus === 'PENDING' || proposalStatus === 'ACTIVE')
                );
                
                if (!shouldExpire) {
                  enhancedLogger.info(`⏸️ Skipping expiration for match ${matchData.matchId} — proposal creation pending/in progress`, {
                    matchId: matchData.matchId,
                    proposalStatus,
                    isCompleted,
                    bothPlayersHaveResults,
                    expiresAt: new Date(matchData.expiresAt).toISOString(),
                    now: new Date(now).toISOString()
                  });
                  continue; // Skip expiration for this match
                }
              }
            } catch (dbError: any) {
              // If database check fails, log but don't block expiration (fail-safe)
              enhancedLogger.warn(`⚠️ Could not check proposal status for match ${matchData.matchId} before expiration:`, {
                error: dbError?.message,
                matchId: matchData.matchId
              });
            }
            
            // Match can be safely expired
            await this.redis.del(matchKey);
            await this.redis.del(`player:${matchData.player1}`);
            await this.redis.del(`player:${matchData.player2}`);
            enhancedLogger.info(`🧹 Cleaned up expired match: ${matchData.matchId}`);
          }
        }
      }
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error during cleanup:', error);
    }
  }

  async evictPlayer(wallet: string): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      await this.cleanupOldEntriesForWallet(wallet);
      enhancedLogger.info(`🚪 Player ${wallet} evicted from matchmaking queues`);
    } catch (error: unknown) {
      enhancedLogger.error(`❌ Error evicting player ${wallet}:`, error);
      throw error;
    }
  }

  async cancelMatch(matchId: string): Promise<void> {
    try {
      await this.ensureInitialized();
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      const matchKey = `match:${matchId}`;
      const matchDataJson = await this.redis.hGet(matchKey, 'data');

      if (matchDataJson) {
        const matchData: MatchData = JSON.parse(matchDataJson as string);

        if (matchData.player1) {
          await this.cleanupOldEntriesForWallet(matchData.player1);
        }
        if (matchData.player2) {
          await this.cleanupOldEntriesForWallet(matchData.player2);
        }
      }

      await this.redis.del(matchKey);
      enhancedLogger.info(`🛑 Match ${matchId} removed from Redis matchmaking service`);
    } catch (error: unknown) {
      enhancedLogger.error(`❌ Error cancelling match ${matchId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const redisMatchmakingService = new RedisMatchmakingService();

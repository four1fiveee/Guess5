import { getRedisMM } from '../config/redis';
import { enhancedLogger } from './enhancedLogger';

export interface GameState {
  startTime: number;
  player1StartTime: number;
  player2StartTime: number;
  player1Guesses: string[];
  player2Guesses: string[];
  player1Solved: boolean;
  player2Solved: boolean;
  word: string;
  matchId: string;
  lastActivity: number;
  completed: boolean;
}

export const getGameState = async (matchId: string): Promise<GameState | null> => {
  try {
    const redis = getRedisMM();
    const gameStateJson = await redis.hGet(`game:${matchId}`, 'state');
    if (!gameStateJson) {
      return null;
    }
    return JSON.parse(gameStateJson) as GameState;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error getting game state from Redis:', error);
    return null;
  }
};

export const setGameState = async (matchId: string, gameState: GameState): Promise<void> => {
  try {
    const redis = getRedisMM();
    await redis.hSet(`game:${matchId}`, 'state', JSON.stringify(gameState));
    await redis.expire(`game:${matchId}`, 3600); // 1 hour TTL
    enhancedLogger.info(`✅ Game state saved to Redis for match: ${matchId}`);
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error setting game state in Redis:', error);
    throw error;
  }
};

export const deleteGameState = async (matchId: string): Promise<void> => {
  try {
    const redis = getRedisMM();
    await redis.del(`game:${matchId}`);
    enhancedLogger.info(`✅ Game state deleted from Redis for match: ${matchId}`);
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error deleting game state from Redis:', error);
    throw error;
  }
};

export const getAllGameStates = async (): Promise<Array<[string, GameState]>> => {
  try {
    const redis = getRedisMM();
    const keys = await redis.keys('game:*');
    const gameStates: Array<[string, GameState]> = [];
    
    for (const key of keys) {
      const matchId = key.replace('game:', '');
      const gameState = await getGameState(matchId);
      if (gameState) {
        gameStates.push([matchId, gameState]);
      }
    }
    
    return gameStates;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error getting all game states from Redis:', error);
    return [];
  }
};

export const cleanupExpiredGameStates = async (): Promise<number> => {
  try {
    const redis = getRedisMM();
    const keys = await redis.keys('game:*');
    let cleanedCount = 0;
    
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) { // No expiration set
        await redis.expire(key, 3600); // Set 1 hour TTL
        cleanedCount++;
      }
    }
    
    enhancedLogger.info(`✅ Cleaned up ${cleanedCount} game states in Redis`);
    return cleanedCount;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Error cleaning up game states in Redis:', error);
    return 0;
  }
};

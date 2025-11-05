// @ts-nocheck
const expressMatch = require('express');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');
const RESULTS_ATTESTOR_ADDRESS = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
const { Not, LessThan, Between, IsNull } = require('typeorm');
const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const path = require('path');
const wordListModule = require(path.join(__dirname, '../wordList'));
const { getRandomWord } = wordListModule;

// Import database connection for pending claims handler
const { AppDataSource } = require('../db/index');

// Import Squads service for non-custodial vault operations
const { squadsVaultService } = require('../services/squadsVaultService');

// Import Redis helpers to replace in-memory storage
const { getGameState, setGameState, deleteGameState } = require('../utils/redisGameState');
const { getMatchmakingLock, setMatchmakingLock, deleteMatchmakingLock } = require('../utils/redisMatchmakingLocks');
const { redisMatchmakingService } = require('../services/redisMatchmakingService');
const { getRedisMM } = require('../config/redis');

// Redis-based memory management for 1000 concurrent users
const { redisMemoryManager } = require('../utils/redisMemoryManager');

// Helper function to check fee wallet balance
const checkFeeWalletBalance = async (requiredAmount: number): Promise<boolean> => {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    const feeWalletPublicKey = new PublicKey(FEE_WALLET_ADDRESS);
    
    const balance = await connection.getBalance(feeWalletPublicKey);
    const hasEnough = balance >= requiredAmount;
    
    console.log('💰 Fee wallet balance check:', {
      balance: balance / 1000000000, // Convert lamports to SOL
      required: requiredAmount / 1000000000,
      hasEnough
    });
    
    return hasEnough;
  } catch (error: unknown) {
    console.error('❌ Error checking fee wallet balance:', error);
    return false;
  }
};

// Memory limit check function using Redis
const checkMemoryLimits = async () => {
  try {
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    
    // Log warnings
    stats.warnings.forEach((warning: string) => {
      console.warn(`⚠️ ${warning}`);
    });

    return stats;
  } catch (error) {
    console.error('❌ Error checking memory limits:', error);
    return {
      activeGames: 0,
      matchmakingLocks: 0,
      inMemoryMatches: 0,
      warnings: []
    };
  }
};

// Simplified matchmaking without idempotency for now

// Enhanced cleanup function using Redis memory manager
const cleanupInactiveGames = async () => {
  try {
    const result = await redisMemoryManager.getInstance().cleanupInactiveGames();
    
    if (result.cleanedGames > 0 || result.cleanedLocks > 0) {
      console.log(`🧹 Memory cleanup completed:`, {
        games: result.cleanedGames,
        locks: result.cleanedLocks
      });
    }
    
    // Log current memory stats
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    console.log(`📊 Memory stats: ${stats.activeGames} active games, ${stats.matchmakingLocks} locks, ${stats.inMemoryMatches} in-memory matches`);
    
    // Log memory usage if high
    if (stats.activeGames > 100 || stats.matchmakingLocks > 50) {
      console.warn(`⚠️ High memory usage detected:`, stats);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    return { cleanedGames: 0, cleanedLocks: 0 };
  }
};

// Update game activity
const updateGameActivity = async (matchId: string) => {
  const gameState = await getGameState(matchId);
  if (gameState) {
    gameState.lastActivity = Date.now();
    await setGameState(matchId, gameState);
  }
};

// Mark game as completed and cleanup immediately
const markGameCompleted = async (matchId: string) => {
  const gameState = await getGameState(matchId);
  if (gameState) {
    gameState.completed = true;
    gameState.lastActivity = Date.now();
    console.log(`✅ Game ${matchId} marked as completed`);
    // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
    await deleteGameState(matchId);
    console.log(`🧹 Immediate cleanup: Removed completed game ${matchId} from Redis`);
  }
  
  // Also cleanup from database
  (async () => {
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      
      const match = await matchRepository.findOne({ where: { id: matchId } });
      if (match) {
        match.status = 'completed';
        await matchRepository.save(match);
        console.log(`✅ Marked match ${matchId} as completed in database`);
        
        // NOTE: We do NOT remove completed matches - they are kept for long-term storage and CSV downloads
      }
    } catch (error: unknown) {
      console.error(`❌ Error marking match ${matchId} as completed:`, error);
    }
  })();
};

// Periodic cleanup function with enhanced monitoring
const periodicCleanup = async () => {
  try {
    console.log('🧹 Running periodic cleanup...');
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up matches older than 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const staleMatches = await matchRepository.find({
      where: [
        { status: 'waiting', createdAt: LessThan(tenMinutesAgo) },
        { status: 'escrow', createdAt: LessThan(tenMinutesAgo) }
      ]
    });
    
    if (staleMatches.length > 0) {
      console.log(`🧹 Cleaning up ${staleMatches.length} stale matches`);
      await matchRepository.remove(staleMatches);
      console.log(`✅ Cleaned up ${staleMatches.length} stale matches`);
    }
    
    // Process refunds for payment_required matches that are too old (5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oldPaymentRequiredMatches = await matchRepository.find({
      where: {
        status: 'payment_required',
        updatedAt: LessThan(fiveMinutesAgo)
      }
    });
    
    if (oldPaymentRequiredMatches.length > 0) {
      console.log(`💰 Processing refunds for ${oldPaymentRequiredMatches.length} old payment_required matches`);
      
      for (const match of oldPaymentRequiredMatches) {
        await processAutomatedRefunds(match, 'payment_timeout');
      }
      
      console.log(`✅ Processed refunds for ${oldPaymentRequiredMatches.length} old payment_required matches`);
    }
    
    // NOTE: We do NOT clean up completed matches - they are kept for long-term storage and CSV downloads
    // Only clean up incomplete/stale matches that are blocking the system
    
    // Log memory statistics from Redis
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    console.log('📊 Memory statistics:', stats);
    
    // Alert if memory usage is high
    if (stats.activeGames > 50) {
      console.warn(`⚠️ High active games count: ${stats.activeGames}`);
    }
    
    if (stats.matchmakingLocks > 20) {
      console.warn(`⚠️ High matchmaking locks count: ${stats.matchmakingLocks}`);
    }
    
    console.log('✅ Periodic cleanup completed');
    
  } catch (error: unknown) {
    console.error('❌ Error in periodic cleanup:', error);
  }
};

// Run periodic cleanup every 5 minutes
setInterval(periodicCleanup, 5 * 60 * 1000);

// API endpoint to clear Redis matchmaking data (for testing)
const clearMatchmakingDataHandler = async (req: any, res: any) => {
  try {
    console.log('🧹 Clearing Redis matchmaking data...');
    await redisMatchmakingService.clearAllMatchmakingData();
    res.json({ success: true, message: 'Redis matchmaking data cleared' });
  } catch (error: unknown) {
    console.error('❌ Error clearing matchmaking data:', error);
    res.status(500).json({ error: 'Failed to clear matchmaking data' });
  }
};

// Word list for games
const wordList = [
  'APPLE', 'BEACH', 'CHAIR', 'DREAM', 'EARTH', 'FLAME', 'GRAPE', 'HEART',
  'IMAGE', 'JUICE', 'KNIFE', 'LEMON', 'MUSIC', 'NIGHT', 'OCEAN', 'PEACE',
  'QUEEN', 'RADIO', 'SMILE', 'TABLE', 'UNITY', 'VOICE', 'WATER', 'YOUTH',
  'ZEBRA', 'ALPHA', 'BRAVE', 'CLOUD', 'DANCE', 'EAGLE', 'FAITH', 'GLORY',
  'HAPPY', 'IDEAL', 'JOYCE', 'KARMA', 'LIGHT', 'MAGIC', 'NOVEL', 'OPERA',
  'PRIDE', 'QUIET', 'RADAR', 'SPACE', 'TRUTH', 'UNITY', 'VALUE', 'WORLD'
];

const requestMatchHandler = async (req: any, res: any) => {
  const startTime = Date.now();
  try {
    console.log('📥 Received match request:', {
      body: req.body,
      headers: req.headers,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });

    // Ensure database is initialized
    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in requestMatchHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }

    // Check memory limits before processing
    const memoryStats = await checkMemoryLimits();
    if (memoryStats.activeGames >= 1000) { // MAX_ACTIVE_GAMES constant
      console.warn('🚨 Server at capacity - rejecting match request');
      return res.status(503).json({ error: 'Server at capacity, please try again later' });
    }

    const wallet = req.body.wallet;
    const entryFee = Number(req.body.entryFee);
    

    
    if (!wallet || !entryFee) {
      console.log('❌ Missing required fields:', { wallet: !!wallet, entryFee: !!entryFee });
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (isNaN(entryFee) || entryFee <= 0) {
      console.log('❌ Invalid entry fee:', { entryFee, isNaN: isNaN(entryFee) });
      return res.status(400).json({ error: 'Invalid entry fee' });
    }

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      console.log('❌ Invalid wallet address format:', wallet);
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Validate entry fee is reasonable (between 0.001 and 100 SOL)
    if (entryFee < 0.001 || entryFee > 100) {
      console.log('❌ Entry fee out of reasonable range:', entryFee);
      return res.status(400).json({ error: 'Entry fee must be between 0.001 and 100 SOL' });
    }



    // CRITICAL: Implement locking to prevent race conditions
    const lockKey = `matchmaking_${wallet}`;
    if ((await getMatchmakingLock(lockKey)) !== null) {
      console.log('⏳ Player already in matchmaking, returning existing lock');
      return res.status(429).json({ error: 'Matchmaking in progress, please wait' });
    }

    // Create lock for this player with enhanced tracking
    const matchmakingPromise = (async () => {
      try {
        return await performMatchmaking(wallet, entryFee);
      } finally {
        // Always clean up the lock
        await deleteMatchmakingLock(lockKey);
      }
    })();

    await setMatchmakingLock(lockKey, {
      promise: matchmakingPromise,
      timestamp: Date.now(),
      wallet: wallet,
      entryFee: entryFee
    });
    
    const result = await matchmakingPromise;
    const duration = Date.now() - startTime;
    console.log(`✅ Matchmaking completed for ${wallet} in ${duration}ms:`, result);
    res.json(result);
    
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Error in requestMatchHandler after', duration, 'ms:', error);
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      name: errorName,
      wallet: req.body?.wallet,
      entryFee: req.body?.entryFee,
      timestamp: new Date().toISOString()
    });
    
    // Clean up any locks that might have been created
    if (req.body.wallet) {
      const lockKey = `matchmaking_${req.body.wallet}`;
      if ((await getMatchmakingLock(lockKey)) !== null) {
        await deleteMatchmakingLock(lockKey);
      }
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Separate function for the actual matchmaking logic
const performMatchmaking = async (wallet: string, entryFee: number) => {
  try {
    console.log(`🔒 REDIS ATOMIC: Starting matchmaking for wallet: ${wallet} with entry fee: ${entryFee}`);
    
    // Get database repository for cleanup and validation
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up old matches for this player
    await cleanupOldMatches(matchRepository, wallet);
    
    // Check for existing active matches
    const existingMatch = await checkExistingMatches(matchRepository, wallet);
    if (existingMatch) {
      return existingMatch;
    }
    
    // REDIS ATOMIC MATCHMAKING: Use Redis service for high-scale operations

    const redisResult = await redisMatchmakingService.addPlayerToQueue(wallet, entryFee);
    
    if (redisResult.status === 'matched' && redisResult.matchId) {
  
      
      // Get match data from Redis
      const matchData = await redisMatchmakingService.getMatch(redisResult.matchId);
      if (!matchData) {
        throw new Error('Match data not found in Redis after creation');
      }
      
      // Create database record for the match FIRST
      const newMatch = new Match();
      newMatch.id = matchData.matchId;
      newMatch.player1 = matchData.player1;
      newMatch.player2 = matchData.player2;
      newMatch.entryFee = matchData.entryFee;
      newMatch.status = 'payment_required';
      newMatch.matchStatus = 'PENDING';
      newMatch.word = getRandomWord();
      newMatch.createdAt = new Date(matchData.createdAt);
      newMatch.updatedAt = new Date();
      
      await matchRepository.save(newMatch);
      console.log(`✅ Database record created for Redis match: ${matchData.matchId}`);
      
      // Create Squads vault for fund custody AFTER database record exists
      console.log('🔧 Creating Squads vault for fund custody...', {
        matchId: matchData.matchId,
        player1: matchData.player1,
        player2: matchData.player2,
        entryFee: matchData.entryFee
      });
      
      let vaultResult;
      try {
        const player1Pubkey = new PublicKey(matchData.player1);
        const player2Pubkey = new PublicKey(matchData.player2);
        console.log('🔧 Creating vault with PublicKeys:', {
          player1: player1Pubkey.toString(),
          player2: player2Pubkey.toString()
        });
        vaultResult = await squadsVaultService.createMatchVault(
          matchData.matchId,
          player1Pubkey,
          player2Pubkey,
          matchData.entryFee
        );
        console.log('🔧 Vault creation result:', { success: vaultResult?.success, error: vaultResult?.error });
      } catch (vaultError: unknown) {
        const vaultErrorMessage = vaultError instanceof Error ? vaultError.message : String(vaultError);
        console.error('❌ Exception during vault creation:', vaultErrorMessage);
        console.error('❌ Vault creation stack:', vaultError instanceof Error ? vaultError.stack : 'No stack');
        throw new Error(`Multisig vault creation failed: ${vaultErrorMessage}`);
      }
      
      if (!vaultResult || !vaultResult.success) {
        console.error('❌ Failed to create multisig vault:', vaultResult?.error || 'Unknown error');
        throw new Error(`Multisig vault creation failed: ${vaultResult?.error || 'Unknown error'}`);
      }
      
      console.log('✅ Multisig vault created:', {
        squadsVaultAddress: vaultResult.vaultAddress
      });

      // Update match with vault address
      newMatch.squadsVaultAddress = vaultResult.vaultAddress;
      newMatch.matchStatus = 'VAULT_CREATED';
      await matchRepository.save(newMatch);
      
      return {
        status: 'matched',
        matchId: matchData.matchId,
        player1: matchData.player1,
        player2: matchData.player2,
        entryFee: matchData.entryFee,
        squadsVaultAddress: vaultResult.vaultAddress,
        vaultAddress: vaultResult.vaultAddress,
        message: 'Match created - both players must pay entry fee to start game'
      };
    } else if (redisResult.status === 'waiting') {
      console.log(`⏳ REDIS: Player added to waiting queue: ${wallet}`);
      
      // Don't create database record for waiting players - let Redis handle everything
      // This prevents the synchronization issue between database and Redis
      console.log(`✅ Player ${wallet} is waiting in Redis queue (${redisResult.waitingCount || 1} waiting)`);
      
      return {
        status: 'waiting',
        waitingCount: redisResult.waitingCount || 1,
        message: 'Waiting for opponent to join'
      };
    } else {
      throw new Error(`Unexpected Redis matchmaking result: ${redisResult.status}`);
    }
    
  } catch (error: unknown) {
    console.error('❌ Error in performMatchmaking:', error);
    // Clean up any locks that might have been created
    const lockKey = `matchmaking_${wallet}`;
    if ((await getMatchmakingLock(lockKey)) !== null) {
      await deleteMatchmakingLock(lockKey);
    }
    throw error;
  }
};

// Helper function to cleanup old matches for a player
const cleanupOldMatches = async (matchRepository: any, wallet: string) => {
  
  
  // Use raw SQL to avoid TypeORM column issues - only select existing columns
  // Don't cleanup matches created in the last 30 seconds to avoid race conditions
  // Also, don't cleanup payment_required, escrow, or active matches (these are in progress)
  const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
  const oldPlayerMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "player1Paid",
      "player2Paid"
    FROM "match" 
    WHERE (("player1" = $1 AND "status" NOT IN ($2, $3, $4, $5)) OR ("player2" = $6 AND "status" NOT IN ($7, $8, $9, $10)))
      AND "createdAt" < $11
  `, [wallet, 'escrow', 'completed', 'active', 'payment_required', 
      wallet, 'escrow', 'completed', 'active', 'payment_required', 
      thirtySecondsAgo]);
  
  if (oldPlayerMatches.length > 0) {

    
    // Process refunds for any matches where players paid but match failed
    for (const match of oldPlayerMatches) {
      if ((match.player1Paid || match.player2Paid) && match.status !== 'completed') {
        await processAutomatedRefunds(match, 'cleanup');
      }
    }
    
    // Remove old matches using raw SQL - EXCLUDE completed, active, escrow, and payment_required matches
        await matchRepository.query(`
      DELETE FROM "match" 
      WHERE (("player1" = $1 AND "status" NOT IN ($2, $3, $4, $5)) OR ("player2" = $6 AND "status" NOT IN ($7, $8, $9, $10)))
        AND "createdAt" < $11
    `, [wallet, 'escrow', 'completed', 'active', 'payment_required', 
        wallet, 'escrow', 'completed', 'active', 'payment_required', 
        thirtySecondsAgo]);
  }
  
  // Also cleanup any stale waiting entries older than 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const staleWaitingMatches = await matchRepository.query(`
    SELECT id FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['waiting', fiveMinutesAgo]);
  
  if (staleWaitingMatches.length > 0) {
    await matchRepository.query(`
      DELETE FROM "match" 
      WHERE "status" = $1 AND "createdAt" < $2
    `, ['waiting', fiveMinutesAgo]);
  }
  
  // Clean up stale payment_required matches (e.g., stuck in deposit screen for too long)
  // After 3 minutes, refund any deposits and cancel the match
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
  const stalePaymentMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "player1Paid",
      "player2Paid",
      "squadsVaultAddress"
    FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['payment_required', threeMinutesAgo]);
  
  if (stalePaymentMatches.length > 0) {
    console.log(`⏰ Found ${stalePaymentMatches.length} stale payment_required matches for ${wallet}, processing refunds...`);
    for (const match of stalePaymentMatches) {
      // Process refunds if players have deposited
      if ((match.player1Paid || match.player2Paid) || match.squadsVaultAddress) {
        console.log(`💰 Processing refund for stale match ${match.id} (players may have deposited)`);
        await processAutomatedRefunds(match, 'payment_timeout');
      }
      
      // Delete the stale match
      await matchRepository.query(`
        DELETE FROM "match" WHERE id = $1
      `, [match.id]);
      console.log(`✅ Cleaned up stale payment_required match ${match.id}`);
    }
  }
  
  // Clean up stale active matches (e.g., game started but player left)
  // After 10 minutes, cancel and refund
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const staleActiveMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "squadsVaultAddress"
    FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['active', tenMinutesAgo]);
  
  if (staleActiveMatches.length > 0) {
    console.log(`⏰ Found ${staleActiveMatches.length} stale active matches for ${wallet}, processing refunds...`);
    for (const match of staleActiveMatches) {
      if (match.squadsVaultAddress) {
        console.log(`💰 Processing refund for stale active match ${match.id}`);
        await processAutomatedRefunds(match, 'game_abandoned');
      }
      
      await matchRepository.query(`
        DELETE FROM "match" WHERE id = $1
      `, [match.id]);
      console.log(`✅ Cleaned up stale active match ${match.id}`);
    }
  }
  
  // CRITICAL: We do NOT clean up completed matches - they are kept for long-term storage and CSV downloads
  // Only clean up incomplete/stale matches that are blocking the system
  // Completed matches (status = 'completed') are NEVER deleted by cleanup functions
};

// Helper function to check for existing matches and cleanup if needed
const checkExistingMatches = async (matchRepository: any, wallet: string) => {
  // First, cleanup any old matches for this player
  await cleanupOldMatches(matchRepository, wallet);
  
  // Now check if there are any remaining active matches using raw SQL
  // Include payment_required, active, and escrow as existing matches
  const existingMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      "entryFee",
      status,
      "squadsVaultAddress"
    FROM "match" 
    WHERE (("player1" = $1 AND "status" IN ($2, $3, $4)) OR ("player2" = $5 AND "status" IN ($6, $7, $8)))
    LIMIT 1
  `, [wallet, 'active', 'escrow', 'payment_required', wallet, 'active', 'escrow', 'payment_required']);
  
  if (existingMatches.length > 0) {
    const existingMatch = existingMatches[0];
    console.log('⚠️ Player still has an active/escrow match after cleanup');
    return {
      status: existingMatch.squadsVaultAddress ? 'matched' : 'vault_pending',
      matchId: existingMatch.id,
      player1: existingMatch.player1,
      player2: existingMatch.player2,
      entryFee: existingMatch.entryFee,
      squadsVaultAddress: existingMatch.squadsVaultAddress || null,
      vaultAddress: existingMatch.squadsVaultAddress || null,
      matchStatus: existingMatch.status,
      message: existingMatch.status === 'escrow' ? 'Match created - please lock your entry fee' : 'Already in active match'
    };
  }
  
  return null;
};

// Helper function to find waiting players with simplified logic
const findWaitingPlayer = async (matchRepository: any, wallet: string, entryFee: number) => {
  const tolerance = 0.01; // Increased tolerance to 0.01 SOL for better matching
  const minEntryFee = entryFee - tolerance;
  const maxEntryFee = entryFee + tolerance;
  
  try {

    
    // First try exact match using raw SQL
    let waitingMatches = await matchRepository.query(`
      SELECT 
        id,
        "player1",
        "entryFee"
      FROM "match" 
      WHERE "status" = $1 
        AND "entryFee" BETWEEN $2 AND $3 
        AND "player2" IS NULL 
        AND "player1" != $4
      ORDER BY "createdAt" ASC 
      LIMIT 1
    `, ['waiting', minEntryFee, maxEntryFee, wallet]);
    
    console.log(`  Found ${waitingMatches.length} waiting matches with exact tolerance`);
    
    // If no exact match, try flexible matching (within 10% tolerance for better matching)
    if (waitingMatches.length === 0) {
      const flexibleMinEntryFee = entryFee * 0.90;
      const flexibleMaxEntryFee = entryFee * 1.10;
      
  
      console.log(`  Range: ${flexibleMinEntryFee} - ${flexibleMaxEntryFee} SOL`);
      
      waitingMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "entryFee"
        FROM "match" 
        WHERE "status" = $1 
          AND "entryFee" BETWEEN $2 AND $3 
          AND "player2" IS NULL 
          AND "player1" != $4
        ORDER BY "createdAt" ASC 
        LIMIT 1
      `, ['waiting', flexibleMinEntryFee, flexibleMaxEntryFee, wallet]);
      
      console.log(`  Found ${waitingMatches.length} waiting matches with flexible tolerance`);
    }
    
    // If still no match, try any waiting player (for testing)
    if (waitingMatches.length === 0) {
  
      
      waitingMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "entryFee"
        FROM "match" 
        WHERE "status" = $1 
          AND "player2" IS NULL 
          AND "player1" != $2
        ORDER BY "createdAt" ASC 
        LIMIT 1
      `, ['waiting', wallet]);
      
      console.log(`  Found ${waitingMatches.length} any waiting players`);
    }
    
    if (waitingMatches.length > 0) {
      const waitingEntry = waitingMatches[0];
      
  
      
      // Create a NEW match record (not update the waiting entry)
      const actualEntryFee = Math.min(waitingEntry.entryFee, entryFee);
      
      // Generate game word
      const gameWord = getRandomWord();
      
      // Create new match record
      const newMatchResult = await matchRepository.query(`
        INSERT INTO "match" (
          "player1", "player2", "entryFee", "status", "word", 
          "player1Paid", "player2Paid", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, "player1", "player2", "entryFee", "status"
      `, [
        waitingEntry.player1, wallet, actualEntryFee, 'payment_required', gameWord,
        false, false, new Date(), new Date()
      ]);
      
      const newMatch = newMatchResult[0];
      
      // Delete the waiting entry since we've created a match
      await matchRepository.query(`
        DELETE FROM "match" 
        WHERE id = $1
      `, [waitingEntry.id]);
      
      console.log(`✅ Successfully created match ${newMatch.id} between ${waitingEntry.player1} and ${wallet}`);
      
      return {
        wallet: waitingEntry.player1,
        entryFee: actualEntryFee,
        matchId: newMatch.id
      };
    }
    
    console.log(`❌ No waiting players found for ${wallet} with entry fee ${entryFee}`);
    return null;
    
  } catch (error: unknown) {
    console.error('❌ Error in findWaitingPlayer:', error);
    throw error;
  }
};

// REDIS ATOMIC MATCHMAKING: This function has been replaced with Redis-based matchmaking
// The findAndClaimWaitingPlayer function is no longer needed as we use redisMatchmakingService

// Helper function to create a match (now handled in findWaitingPlayer)
const createMatch = async (matchRepository: any, waitingPlayer: any, wallet: string, entryFee: number) => {
  try {
    console.log('🎮 Match already created in findWaitingPlayer, returning details:', {
      player1: waitingPlayer.wallet,
      player2: wallet,
      entryFee: waitingPlayer.entryFee,
      matchId: waitingPlayer.matchId
    });
    
    return {
    status: 'vault_pending',
      matchId: waitingPlayer.matchId,
      player1: waitingPlayer.wallet,
      player2: wallet,
      entryFee: waitingPlayer.entryFee,
    squadsVaultAddress: null,
    vaultAddress: null,
      message: 'Match created - both players must pay entry fee to start game'
    };
  } catch (error: unknown) {
    console.error('❌ Error in createMatch:', error);
    throw error;
  }
};

// REDIS ATOMIC MATCHMAKING: This function has been replaced with Redis-based matchmaking
// The createWaitingEntry function is no longer needed as we use redisMatchmakingService

// Debug endpoint to check waiting players
const debugWaitingPlayersHandler = async (req: any, res: any) => {
  try {

    
    let dbWaitingMatches = [];
    let dbActiveMatches = [];
    
    // Try database first
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      
      // Get all waiting matches from database
      dbWaitingMatches = await matchRepository.find({
        where: { status: 'waiting' },
        order: { createdAt: 'ASC' }
      });
      
      // Get all active matches from database
      dbActiveMatches = await matchRepository.find({
        where: { status: 'active' },
        order: { createdAt: 'ASC' }
      });
      
      console.log('✅ Database queries successful');
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn('⚠️ Database queries failed:', errorMessage);
    }
    
    // Get Redis-based matches
    const memoryActiveMatches = [];
    
    // Check active games in Redis
    const { getAllGameStates } = require('../utils/redisGameState');
    const redisGameStates = await getAllGameStates();
    for (const [matchId, gameState] of redisGameStates) {
      memoryActiveMatches.push({
        id: matchId,
        player1: 'active_game',
        player2: 'active_game',
        entryFee: 0,
        status: 'active',
        source: 'redis'
      });
    }
    
    const totalWaiting = dbWaitingMatches.length;
        const totalActive = dbActiveMatches.length + memoryActiveMatches.length;
    
    console.log('Debug results:', {
      database: { waiting: dbWaitingMatches.length, active: dbActiveMatches.length },
      memory: { waiting: 0, active: memoryActiveMatches.length },
      total: { waiting: totalWaiting, active: totalActive }
    });
    
    res.json({
      database: {
        waitingCount: dbWaitingMatches.length,
        activeCount: dbActiveMatches.length,
        waitingPlayers: dbWaitingMatches.map((m: any) => ({
          id: m.id,
          player1: m.player1,
          entryFee: m.entryFee,
          createdAt: m.createdAt,
          source: 'database'
        })),
        activeMatches: dbActiveMatches.map((m: any) => ({
          id: m.id,
          player1: m.player1,
          player2: m.player2,
          entryFee: m.entryFee,
          status: m.status,
          source: 'database'
        }))
      },
      memory: {
        waitingCount: 0,
        activeCount: memoryActiveMatches.length,
        waitingPlayers: [],
        activeMatches: memoryActiveMatches
      },
      total: {
        waiting: totalWaiting,
        active: totalActive
      }
    });
  } catch (error: unknown) {
    console.error('❌ Error in debugWaitingPlayersHandler:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Simple test endpoint
const matchTestHandler = async (req: any, res: any) => {
  try {
    console.log('🧪 Test endpoint called');
    res.json({ 
      status: 'ok', 
      message: 'Test endpoint working',
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: 'Test endpoint failed' });
  }
};

// Simple test endpoint for repository debugging
const testRepositoryHandler = async (req: any, res: any) => {
  try {
    console.log('🧪 Testing repository creation...');
    
    // Test 1: Check if Match entity is available
    console.log('🔍 Match entity available:', !!Match);
    
    // Test 2: Check if AppDataSource is available
    const { AppDataSource } = require('../db/index');
    console.log('🔍 AppDataSource available:', !!AppDataSource);
    console.log('🔍 AppDataSource initialized:', AppDataSource.isInitialized);
    
    // Test 3: Try to get repository using AppDataSource
    try {
      const testRepo = AppDataSource.getRepository(Match);
      console.log('✅ Repository created successfully');
      res.json({ 
        status: 'ok', 
        message: 'Repository test successful',
        matchEntity: !!Match,
        appDataSource: !!AppDataSource,
        appDataSourceInitialized: AppDataSource.isInitialized,
        repository: !!testRepo
      });
    } catch (repoError: unknown) {
      const errorMessage = repoError instanceof Error ? repoError.message : String(repoError);
      const errorName = repoError instanceof Error ? repoError.name : undefined;
      const errorStack = repoError instanceof Error ? repoError.stack : undefined;
      console.error('❌ Repository creation failed:', repoError);
      res.status(500).json({ 
        error: 'Repository creation failed',
        details: {
          message: errorMessage,
          name: errorName,
          stack: errorStack
        }
      });
    }
  } catch (error: unknown) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: 'Test endpoint failed' });
  }
};

// Simple database test endpoint
const testDatabaseHandler = async (req: any, res: any) => {
  try {
    console.log('🧪 Testing basic database operations...');
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Test 1: Simple count query
    console.log('🔍 Testing count query...');
    const count = await matchRepository.count();
    console.log('✅ Count query successful:', count);
    
    // Test 2: Simple find query
    console.log('🔍 Testing find query...');
    const allMatches = await matchRepository.find({ take: 5 });
    console.log('✅ Find query successful, found:', allMatches.length, 'matches');
    
    // Test 3: Test with specific entry fee
    console.log('🔍 Testing find with entry fee...');
    const testEntryFee = 0.104;
    const matchesWithFee = await matchRepository.find({
      where: { entryFee: testEntryFee },
      take: 1
    });
    console.log('✅ Entry fee query successful, found:', matchesWithFee.length, 'matches');
    
    res.json({
      status: 'ok',
      message: 'Database operations successful',
      totalMatches: count,
      sampleMatches: allMatches.length,
      entryFeeMatches: matchesWithFee.length
    });
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Database test failed:', error);
    res.status(500).json({ 
      error: 'Database test failed',
      details: {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined
      }
    });
  }
};

// Cleanup self-matches endpoint
const cleanupSelfMatchesHandler = async (req: any, res: any) => {
  try {
    console.log('🧹 Cleaning up self-matches...');
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find all active matches
    const activeMatches = await matchRepository.find({
      where: {
        status: 'active',
        player1: Not(null),
        player2: Not(null)
      }
    });
    
    // Filter self-matches
    const selfMatches = activeMatches.filter((match: any) => match.player1 === match.player2);
    
    if (selfMatches.length > 0) {
      console.log(`🧹 Found ${selfMatches.length} self-matches to clean up:`, selfMatches.map((m: any) => m.id));
      await matchRepository.remove(selfMatches);
      console.log('✅ Self-matches cleaned up successfully');
    } else {
      console.log('✅ No self-matches found');
    }
    
    res.json({
      success: true,
      message: 'Self-matches cleaned up',
      removedCount: selfMatches.length,
      removedMatches: selfMatches.map((m: any) => ({ id: m.id, player1: m.player1, player2: m.player2 }))
    });
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// Helper function to determine winner and calculate payout instructions
const determineWinnerAndPayout = async (matchId: any, player1Result: any, player2Result: any) => {
  const { AppDataSource } = require('../db/index');
  const matchRepository = AppDataSource.getRepository(Match);
  const match = await matchRepository.findOne({ where: { id: matchId } });
  
  if (!match) {
    throw new Error('Match not found');
  }

  console.log('🏆 Determining winner for match:', matchId);
  console.log('Player 1 result:', player1Result);
  console.log('Player 2 result:', player2Result);

  let winner = null;
  let payoutResult = null;

  // Winner determination logic:
  // 1. Did you solve the puzzle? (Yes/No)
  // 2. If both solved → Fewest moves wins
  // 3. If same moves → Tie breaker by time (faster wins)
  // 4. If only one solved → That player wins
  // 5. If neither solved → Both lose (tie)
  
  if (player1Result && player2Result) {
    // Both players submitted results
    if (player1Result.won && !player2Result.won) {
      // Player 1 solved, Player 2 didn't
      winner = match.player1;
      console.log('🏆 Player 1 wins - only one solved');
    } else if (player2Result.won && !player1Result.won) {
      // Player 2 solved, Player 1 didn't
      winner = match.player2;
      console.log('🏆 Player 2 wins - only one solved');
    } else if (player1Result.won && player2Result.won) {
      // Both solved - fewest moves wins
      console.log('🏆 Both solved - comparing moves:', {
        player1Moves: player1Result.numGuesses,
        player2Moves: player2Result.numGuesses
      });
      
      if (player1Result.numGuesses < player2Result.numGuesses) {
        // Player 1 wins with fewer moves
        winner = match.player1;
        console.log('🏆 Player 1 wins with fewer moves');
      } else if (player2Result.numGuesses < player1Result.numGuesses) {
        // Player 2 wins with fewer moves
        winner = match.player2;
        console.log('🏆 Player 2 wins with fewer moves');
      } else {
        // Same number of moves - tie breaker by time
        console.log('⚖️ Same moves - tie breaker by time:', {
          player1Time: player1Result.totalTime,
          player2Time: player2Result.totalTime
        });
        
        const timeDiff = Math.abs(player1Result.totalTime - player2Result.totalTime);
        const tolerance = 0.001; // 1 millisecond tolerance for "exact" ties (smallest reasonable unit for web app)
        
        if (timeDiff < tolerance) {
          // Winning tie: Both solved with same moves AND same time (within 1ms tolerance)
          winner = 'tie';
          console.log('🤝 Winning tie: Both solved with same moves AND same time (within 1ms tolerance)');
        } else if (player1Result.totalTime < player2Result.totalTime) {
          winner = match.player1;
          console.log('🏆 Player 1 wins by time');
        } else {
          winner = match.player2;
          console.log('🏆 Player 2 wins by time');
        }
      }
    } else {
      // Both didn't solve - both lose
      winner = 'tie';
      console.log('⚖️ Both players failed to solve');
    }
  } else if (player1Result && !player2Result) {
    // Only player 1 submitted result
    if (player1Result.won) {
      // Player 1 solved, Player 2 didn't (disconnected or lost)
      winner = match.player1;
      console.log('🏆 Player 1 wins - opponent disconnected');
    } else {
      // Player 1 didn't solve, Player 2 didn't solve - both lose
      winner = 'tie';
      console.log('⚖️ Both players failed to solve');
    }
  } else if (player2Result && !player1Result) {
    // Only player 2 submitted result
    if (player2Result.won) {
      // Player 2 solved, Player 1 didn't (disconnected or lost)
      winner = match.player2;
      console.log('🏆 Player 2 wins - opponent disconnected');
    } else {
      // Player 2 didn't solve, Player 1 didn't solve - both lose
      winner = 'tie';
      console.log('⚖️ Both players failed to solve');
    }
  } else {
    // No results submitted - both lose
    winner = 'tie';
    console.log('⚖️ No results submitted');
  }

  console.log('🏆 Winner determined:', winner);

  // Calculate payout instructions
  if (winner && winner !== 'tie') {
    const winnerWallet = winner;
    const loserWallet = winner === match.player1 ? match.player2 : match.player1;
    const entryFee = match.entryFee;
    const totalPot = entryFee * 2; // Total pot is both players' entry fees
    const winnerAmount = totalPot * 0.95; // 95% of total pot to winner
    const feeAmount = totalPot * 0.05; // 5% fee from total pot

    // Use multisig vault for payout
    payoutResult = {
      winner: winnerWallet,
      winnerAmount: winnerAmount,
      feeAmount: feeAmount,
      feeWallet: FEE_WALLET_ADDRESS,
      smartContract: false, // Using multisig vault instead
      transactions: [
        {
          from: 'Multisig Vault',
          to: winnerWallet,
          amount: winnerAmount,
          description: 'Winner payout (95% of total pot) from vault'
        }
      ]
    };

    console.log('💰 Payout calculated:', payoutResult);
  } else if (winner === 'tie') {
    // Determine if this is a winning tie (both solved with same moves AND same time) or losing tie (both failed)
    const isWinningTie = player1Result && player2Result && 
                        player1Result.won && player2Result.won && 
                        player1Result.numGuesses === player2Result.numGuesses &&
                        Math.abs(player1Result.totalTime - player2Result.totalTime) < 0.001;
    
    if (isWinningTie) {
      // Winning tie: Both solved with same moves AND same time (within 1ms tolerance) - FULL REFUND to both players
      console.log('🤝 Winning tie: Both solved with same moves AND same time (within 1ms tolerance) - FULL REFUND to both players');
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: 0,
        refundAmount: match.entryFee, // Full refund for winning tie
        isWinningTie: true, // Flag to indicate this is a winning tie
        feeWallet: FEE_WALLET_ADDRESS,
        transactions: [
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player1,
            amount: match.entryFee,
            description: 'Winning tie refund (player 1)'
          },
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player2,
            amount: match.entryFee,
            description: 'Winning tie refund (player 2)'
          }
        ]
      };
    } else {
      // Losing tie: Both failed to solve - 5% fee kept, 95% refunded to both players
      console.log('🤝 Losing tie: Both failed to solve - 5% fee kept, 95% refunded to both players');
      const feeAmount = match.entryFee * 0.05;
      const refundAmount = match.entryFee * 0.95; // 95% refund to each player
      
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: feeAmount * 2, // Total fees from both players
        refundAmount: refundAmount, // 95% refund amount for each player
        isWinningTie: false, // Flag to indicate this is a losing tie
        feeWallet: FEE_WALLET_ADDRESS,
        transactions: [
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player1,
            amount: refundAmount,
            description: 'Losing tie refund (player 1)'
          },
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player2,
            amount: refundAmount,
            description: 'Losing tie refund (player 2)'
          }
        ]
      };
    }

    console.log('🤝 Tie payout calculated:', payoutResult);
  }

  // Update match with winner and payout
  match.winner = winner;
  match.setPayoutResult(payoutResult);
  match.isCompleted = true;
  
  console.log('💾 Saving match with winner:', {
    matchId: match.id,
    winner: match.winner,
    isCompleted: match.isCompleted,
    player1Result: match.getPlayer1Result(),
    player2Result: match.getPlayer2Result()
  });
  
  await matchRepository.save(match);
  
  console.log('✅ Match saved successfully with winner:', match.winner);

  return payoutResult;
};

const submitResultHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, result } = req.body;
    
    if (!matchId || !wallet || !result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // SERVER-SIDE VALIDATION: Validate result structure
    if (typeof result.won !== 'boolean' || typeof result.numGuesses !== 'number' || !Array.isArray(result.guesses)) {
      return res.status(400).json({ error: 'Invalid result format' });
    }

    // SERVER-SIDE VALIDATION: Validate game rules
    if (result.numGuesses > 7) {
      return res.status(400).json({ error: 'Maximum 7 guesses allowed' });
    }

    // SERVER-SIDE VALIDATION: Get server-side game state from Redis
    const serverGameState = await getGameState(matchId);
    if (!serverGameState) {
      return res.status(404).json({ error: 'Game not found or already completed' });
    }

    // SERVER-SIDE VALIDATION: Validate player is part of this match
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // SERVER-SIDE VALIDATION: Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerKey = isPlayer1 ? 'player1' : 'player2';
    const opponentKey = isPlayer1 ? 'player2' : 'player1';

    // SERVER-SIDE VALIDATION: Check if player already submitted
    if (isPlayer1 && match.getPlayer1Result()) {
      return res.status(400).json({ error: 'Player 1 already submitted result' });
    }
    if (!isPlayer1 && match.getPlayer2Result()) {
      return res.status(400).json({ error: 'Player 2 already submitted result' });
    }

    // FIXED: Make validation less strict to prevent race conditions
    // Only validate that the number of guesses is reasonable
    const serverGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    if (result.guesses.length > serverGuesses.length + 1) {
      console.warn('⚠️ Guess count mismatch detected, but allowing submission:', {
        clientGuesses: result.guesses.length,
        serverGuesses: serverGuesses.length,
        wallet
      });
      // Don't reject - just log the warning
    }

    // FIXED: Remove strict guess-by-guess validation that was causing race conditions
    // The server state might be slightly behind due to Redis updates

    // SERVER-SIDE VALIDATION: Validate win condition
    const expectedWon = serverGameState.word === result.guesses[result.guesses.length - 1];
    if (result.won !== expectedWon) {
      return res.status(400).json({ error: 'Win condition mismatch with server state' });
    }

    // SERVER-SIDE VALIDATION: Use server-side time tracking
    const serverStartTime = isPlayer1 ? serverGameState.player1StartTime : serverGameState.player2StartTime;
    const serverEndTime = Date.now();
    const serverTotalTime = serverEndTime - serverStartTime;

    // SERVER-SIDE VALIDATION: Validate time limits (allow timeout submissions)
    const isTimeoutSubmission = result.reason === 'timeout';
    if (serverTotalTime > 120000 && !isTimeoutSubmission) { // 2 minutes, but allow timeout submissions
      console.log('⏰ Time validation failed:', { serverTotalTime, reason: result.reason, isTimeoutSubmission });
      return res.status(400).json({ error: 'Game time exceeded 2-minute limit' });
    }

    // SERVER-SIDE VALIDATION: Check for impossibly fast times (less than 1 second)
    if (serverTotalTime < 1000) {
      return res.status(400).json({ error: 'Suspiciously fast completion time detected' });
    }



    // Create server-validated result object
    const serverValidatedResult = {
      won: result.won,
      numGuesses: result.numGuesses,
      totalTime: serverTotalTime, // Use server time, not client time
      guesses: result.guesses,
      reason: isTimeoutSubmission ? 'timeout' : 'server-validated'
    };

    // Update server game state in Redis
    if (isPlayer1) {
      serverGameState.player1Solved = result.won;
    } else {
      serverGameState.player2Solved = result.won;
    }
    
    // Save updated game state to Redis
    await setGameState(matchId, serverGameState);

    // Use database transaction to prevent race conditions
    await AppDataSource.transaction(async (manager: any) => {
      // Reload the match within the transaction to get the latest state
      const freshMatch = await manager.findOne(Match, { where: { id: matchId } });
      if (!freshMatch) {
        throw new Error('Match not found in transaction');
      }
      

      
      // Set the result for this player
      if (isPlayer1) {
        freshMatch.setPlayer1Result(serverValidatedResult);
      } else {
        freshMatch.setPlayer2Result(serverValidatedResult);
      }
      
      // Save within the transaction
      await manager.save(freshMatch);
      
      // Update the local match object for consistency
      if (isPlayer1) {
        match.setPlayer1Result(serverValidatedResult);
      } else {
        match.setPlayer2Result(serverValidatedResult);
      }
    });



    // Check if both players have submitted results (regardless of win/loss)
    const updatedMatch = await AppDataSource.manager.findOne(Match, { where: { id: matchId } });
    const player1Result = updatedMatch?.getPlayer1Result();
    const player2Result = updatedMatch?.getPlayer2Result();
    


    // Check if this player solved the puzzle OR if both players have submitted results
    if (result.won || (player1Result && player2Result)) {

      
      // Check if both players have finished playing (solved, run out of guesses, or both submitted results)
      // Use the updated server game state after recording this player's result
      const updatedServerGameState = await getGameState(matchId);
      const player1Finished = updatedServerGameState?.player1Solved || (updatedServerGameState?.player1Guesses?.length || 0) >= 7 || player1Result;
      const player2Finished = updatedServerGameState?.player2Solved || (updatedServerGameState?.player2Guesses?.length || 0) >= 7 || player2Result;
      
      // Check if match should complete:
      // 1. Both players have submitted results (most reliable check), OR
      // 2. Both players finished in game state AND at least one has submitted a result (prevents timeout scanner interference), OR
      // 3. One player has submitted a timeout result and the other player has no result (never got to game)
      const bothHaveResults = !!player1Result && !!player2Result;
      const shouldComplete = bothHaveResults || 
                           ((player1Finished && player2Finished) && (!!player1Result || !!player2Result)) ||
                           (player1Result && player1Result.reason === 'timeout' && !player2Result) ||
                           (player2Result && player2Result.reason === 'timeout' && !player1Result);
      
      if (shouldComplete) {
        // Use transaction to ensure atomic winner determination
        let updatedMatch: any = null;
        const payoutResult = await AppDataSource.transaction(async (manager: any) => {
          // Get the latest match data with both results within the transaction
          updatedMatch = await manager.findOne(Match, { where: { id: matchId } });
          if (!updatedMatch) {
            throw new Error('Match not found during winner determination');
          }
          
          // Handle case where one player times out and the other never gets to the game
          const player1Result = updatedMatch.getPlayer1Result();
          const player2Result = updatedMatch.getPlayer2Result();
          
          if ((player1Result && player1Result.reason === 'timeout' && !player2Result) ||
              (player2Result && player2Result.reason === 'timeout' && !player1Result)) {
            console.log('⏰ One player timed out, other player never got to game - creating timeout result for missing player');
            
            // Create a timeout result for the missing player
            const timeoutResult = {
              won: false,
              numGuesses: 0,
              totalTime: 120000, // 2 minutes
              guesses: [],
              reason: 'timeout'
            };
            
            if (!player1Result) {
              updatedMatch.setPlayer1Result(timeoutResult);
            } else if (!player2Result) {
              updatedMatch.setPlayer2Result(timeoutResult);
            }
            
            // Save the updated match
            await manager.save(updatedMatch);
          }
          
          const result = await determineWinnerAndPayout(matchId, updatedMatch.getPlayer1Result(), updatedMatch.getPlayer2Result());
          
          // IMPORTANT: determineWinnerAndPayout saves its own match instance, so reload to get the winner
          const matchWithWinner = await manager.findOne(Match, { where: { id: matchId } });
          if (matchWithWinner) {
            updatedMatch.winner = matchWithWinner.winner;
            updatedMatch.isCompleted = matchWithWinner.isCompleted;
          }
          
          return result;
        });
        
        // IMPORTANT: Reload match after transaction to ensure we have the latest winner
        const matchRepository = AppDataSource.getRepository(Match);
        updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
        if (!updatedMatch) {
          throw new Error('Match not found after transaction');
        }
        
        // Clear Redis game state after completion
        try {
          await deleteGameState(matchId);
        } catch (error) {
          console.warn('⚠️ Failed to clear Redis game state:', error);
        }
        
        // Execute Squads proposal for winner payout (same as non-solved case)
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          
          const winner = payoutResult.winner;
          const loser = winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1;
          const entryFee = updatedMatch.entryFee;
          
          // Calculate payment amounts
          const totalPot = entryFee * 2; // Total pot is both players' entry fees
          const winnerAmount = totalPot * 0.95; // 95% of total pot to winner
          const feeAmount = totalPot * 0.05; // 5% fee from total pot
          
          // Create Squads proposal for winner payout
          if (!updatedMatch.squadsVaultAddress) {
            console.error('❌ Cannot create payout proposal (solved case): missing squadsVaultAddress', {
              matchId: updatedMatch.id,
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
            });
          } else {
            try {
              const proposalResult = await squadsVaultService.proposeWinnerPayout(
                updatedMatch.squadsVaultAddress,
                new PublicKey(winner),
                winnerAmount,
                new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                feeAmount
              );
              
              if (proposalResult.success) {
                console.log('✅ Squads winner payout proposal created (solved case):', proposalResult.proposalId);
              
                // Update match with proposal information
                updatedMatch.payoutProposalId = proposalResult.proposalId;
                updatedMatch.proposalCreatedAt = new Date();
                updatedMatch.proposalStatus = 'ACTIVE';
                updatedMatch.needsSignatures = 2;
                updatedMatch.matchStatus = 'PROPOSAL_CREATED';
                
                // Save the match with proposal information
                await matchRepository.save(updatedMatch);
                console.log('✅ Match saved with proposal information (solved case):', {
                  matchId: updatedMatch.id,
                  proposalId: proposalResult.proposalId,
                  proposalStatus: 'ACTIVE',
                  needsSignatures: 2,
                });
                
                const paymentInstructions = {
                  winner,
                  loser,
                  winnerAmount,
                  feeAmount,
                  feeWallet: FEE_WALLET_ADDRESS,
                  squadsProposal: true,
                  proposalId: proposalResult.proposalId,
                  transactions: [
                    {
                      from: 'Squads Vault',
                      to: winner,
                      amount: winnerAmount,
                      description: 'Winner payout via Squads proposal (requires signatures)',
                      proposalId: proposalResult.proposalId
                    }
                  ]
                };
                
                (payoutResult as any).paymentInstructions = paymentInstructions;
                (payoutResult as any).paymentSuccess = true;
                (payoutResult as any).squadsProposal = true;
                (payoutResult as any).proposalId = proposalResult.proposalId;
                
                console.log('✅ Squads proposal created and payment instructions set (solved case)');
              } else {
                console.error('❌ Squads proposal creation failed (solved case):', proposalResult.error);
                // Fallback to manual instructions
                const paymentInstructions = {
                  winner,
                  loser,
                  winnerAmount,
                  feeAmount,
                  feeWallet: FEE_WALLET_ADDRESS,
                  squadsProposal: false,
                  transactions: [
                    {
                      from: 'Multisig Vault',
                      to: winner,
                      amount: winnerAmount,
                      description: 'Manual payout to winner (contact support)'
                    }
                  ]
                };
                (payoutResult as any).paymentInstructions = paymentInstructions;
                (payoutResult as any).paymentSuccess = false;
                (payoutResult as any).paymentError = 'Squads proposal failed - contact support';
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error('❌ Error creating Squads proposal (solved case):', errorMessage);
              // Fallback to manual instructions
              const paymentInstructions = {
                winner,
                loser,
                winnerAmount,
                feeAmount,
                feeWallet: FEE_WALLET_ADDRESS,
                squadsProposal: false,
                transactions: [
                  {
                    from: 'Multisig Vault',
                    to: winner,
                    amount: winnerAmount,
                    description: 'Manual payout to winner (contact support)'
                  }
                ]
              };
              (payoutResult as any).paymentInstructions = paymentInstructions;
              (payoutResult as any).paymentSuccess = false;
              (payoutResult as any).paymentError = `Squads proposal failed: ${errorMessage}`;
            }
          }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.getPlayer1Result() && updatedMatch.getPlayer2Result() && 
              updatedMatch.getPlayer1Result().won && updatedMatch.getPlayer2Result().won) {
            // Winning tie - each player gets their entry fee back
            console.log('🤝 Winning tie - each player gets refund...');
            
            const entryFee = updatedMatch.entryFee;
            const feeAmount = entryFee * 0.05; // 5% fee
            
            const paymentInstructions = {
              winner: 'tie',
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              transactions: [
                {
                  from: updatedMatch.player1,
                  to: updatedMatch.player2,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 2'
                },
                {
                  from: updatedMatch.player1,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: updatedMatch.player1,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 2'
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = true;
            
            console.log('✅ Tie payment instructions created');
          } else {
            // Losing tie - skip duplicate handler, use Squads proposal logic in main tie block below
          }
        }
        const finalMatchForSolved = await matchRepository.findOne({ where: { id: matchId } });
        if (finalMatchForSolved) {
          finalMatchForSolved.isCompleted = true;
          finalMatchForSolved.winner = payoutResult.winner;
          finalMatchForSolved.setPayoutResult(payoutResult);
          // Preserve proposal fields if they were set earlier
          if ((updatedMatch as any).payoutProposalId) {
            (finalMatchForSolved as any).payoutProposalId = (updatedMatch as any).payoutProposalId;
            (finalMatchForSolved as any).proposalStatus = (updatedMatch as any).proposalStatus || 'ACTIVE';
            (finalMatchForSolved as any).proposalCreatedAt = (updatedMatch as any).proposalCreatedAt;
            (finalMatchForSolved as any).needsSignatures = (updatedMatch as any).needsSignatures || 2;
            console.log('✅ Preserving proposal fields in final save (solved case):', {
              matchId: finalMatchForSolved.id,
              proposalId: (finalMatchForSolved as any).payoutProposalId,
              proposalStatus: (finalMatchForSolved as any).proposalStatus,
            });
          }
          await matchRepository.save(finalMatchForSolved);
        } else {
          updatedMatch.isCompleted = true;
          updatedMatch.winner = payoutResult.winner;
          updatedMatch.setPayoutResult(payoutResult);
          await matchRepository.save(updatedMatch);
        }
        
        // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
        markGameCompleted(matchId);
        
        res.json({
          status: 'completed',
          winner: (payoutResult as any).winner,
          payout: payoutResult,
          message: 'Game completed - winner determined'
        });
      } else {
        // Both players haven't finished yet - save partial result and wait
        console.log('⏳ Not all players finished yet, waiting for other player');
        await matchRepository.save(match);
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player to finish'
        });
      }
    } else {
      // Player didn't solve - check if both players have finished playing
      // This `serverGameState` needs to be `updatedServerGameState` for consistency
      const updatedServerGameState = await getGameState(matchId);
      const player1Finished = updatedServerGameState?.player1Solved || (updatedServerGameState?.player1Guesses?.length || 0) >= 7;
      const player2Finished = updatedServerGameState?.player2Solved || (updatedServerGameState?.player2Guesses?.length || 0) >= 7;
      
      console.log('🔍 Game end check (non-solved case):', {
        matchId,
        player1Solved: updatedServerGameState?.player1Solved,
        player2Solved: updatedServerGameState?.player2Solved,
        player1Guesses: updatedServerGameState?.player1Guesses?.length || 0,
        player2Guesses: updatedServerGameState?.player2Guesses?.length || 0,
        player1Finished,
        player2Finished,
        bothFinished: player1Finished && player2Finished
      });
      
      if (player1Finished && player2Finished) {
        console.log('🏁 Both players have finished playing, determining winner...');
        
        // Use transaction to ensure atomic winner determination
        let updatedMatch: any = null;
        const payoutResult = await AppDataSource.transaction(async (manager: any) => {
          // Get the latest match data with both results within the transaction
          updatedMatch = await manager.findOne(Match, { where: { id: matchId } });
          if (!updatedMatch) {
            throw new Error('Match not found during winner determination');
          }
          
          console.log('🏆 Winner determination (non-solved) - Match state:', {
            player1Result: updatedMatch.getPlayer1Result(),
            player2Result: updatedMatch.getPlayer2Result(),
            winner: updatedMatch.winner,
            isCompleted: updatedMatch.isCompleted
          });
          
          const result = await determineWinnerAndPayout(matchId, updatedMatch.getPlayer1Result(), updatedMatch.getPlayer2Result());
          
          // IMPORTANT: determineWinnerAndPayout saves its own match instance, so reload to get the winner
          const matchWithWinner = await manager.findOne(Match, { where: { id: matchId } });
          if (matchWithWinner) {
            updatedMatch.winner = matchWithWinner.winner;
            updatedMatch.isCompleted = matchWithWinner.isCompleted;
          }
          
          console.log('🏆 Winner determination completed (non-solved case):', {
            matchId,
            winner: result?.winner,
            updatedMatchWinner: updatedMatch.winner,
            player1Result: updatedMatch.getPlayer1Result(),
            player2Result: updatedMatch.getPlayer2Result()
          });
          
          return result;
        });
        
        // IMPORTANT: Reload match after transaction to ensure we have the latest winner
        const matchRepository = AppDataSource.getRepository(Match);
        updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
        if (!updatedMatch) {
          throw new Error('Match not found after transaction');
        }
        
        console.log('💰 Checking if payout proposal needed...', {
          matchId: updatedMatch.id,
          winner: payoutResult?.winner,
          squadsVaultAddress: (updatedMatch as any).squadsVaultAddress,
          hasPayoutResult: !!payoutResult,
        });
        
          // Execute Squads proposal for winner payout (non-custodial)
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          console.log('💰 Creating Squads proposal for winner payout...');
          
          const winner = payoutResult.winner;
          const loser = winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1;
          const entryFee = updatedMatch.entryFee;
          
          // Check if vault address exists
          if (!updatedMatch.squadsVaultAddress) {
            console.error('❌ Cannot create payout proposal: missing squadsVaultAddress', {
              matchId: updatedMatch.id,
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
            });
          } else {
            // Calculate payment amounts
            const totalPot = entryFee * 2; // Total pot is both players' entry fees
            const winnerAmount = totalPot * 0.95; // 95% of total pot to winner
            const feeAmount = totalPot * 0.05; // 5% fee from total pot
            
            // Create Squads proposal for winner payout
            try {
              // squadsVaultService is now imported at the top of the file
              
              const proposalResult = await squadsVaultService.proposeWinnerPayout(
                updatedMatch.squadsVaultAddress,
                new PublicKey(winner),
                winnerAmount,
                new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                feeAmount
              );
              
              if (proposalResult.success) {
                console.log('✅ Squads winner payout proposal created:', proposalResult.proposalId);
              
                // Update match with proposal information
                updatedMatch.payoutProposalId = proposalResult.proposalId;
                updatedMatch.proposalCreatedAt = new Date();
                updatedMatch.proposalStatus = 'ACTIVE'; // CRITICAL: Set proposalStatus for frontend
                updatedMatch.needsSignatures = 2; // 2-of-3 multisig
                updatedMatch.matchStatus = 'PROPOSAL_CREATED';
                
                // IMPORTANT: Save the match with proposal information
                await matchRepository.save(updatedMatch);
                console.log('✅ Match saved with proposal information:', {
                  matchId: updatedMatch.id,
                  proposalId: proposalResult.proposalId,
                  proposalStatus: 'ACTIVE',
                  needsSignatures: 2,
                });
            
            // Create payment instructions for display
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
                feeWallet: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
                squadsProposal: true,
                proposalId: proposalResult.proposalId,
              transactions: [
                {
                    from: 'Squads Vault',
                  to: winner,
                  amount: winnerAmount,
                    description: 'Winner payout via Squads proposal (requires winner signature)',
                    proposalId: proposalResult.proposalId
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = true;
              (payoutResult as any).squadsProposal = true;
              (payoutResult as any).proposalId = proposalResult.proposalId;
            
              console.log('✅ Squads winner payout proposal completed');
            
            } else {
              console.error('❌ Squads proposal creation failed:', proposalResult.error);
              throw new Error(`Squads proposal failed: ${proposalResult.error}`);
            }
            
          } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('⚠️ Squads proposal failed, falling back to manual instructions:', errorMessage);
            
            // Fallback to manual payment instructions
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
              feeWallet: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
              squadsProposal: false,
              transactions: [
                {
                  from: 'Squads Vault',
                  to: winner,
                  amount: winnerAmount,
                  description: 'Manual payout to winner (contact support)'
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = false;
            (payoutResult as any).paymentError = 'Squads proposal failed - contact support';
            
            console.log('⚠️ Manual payment instructions created');
          }
        }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.getPlayer1Result() && updatedMatch.getPlayer2Result() && 
              updatedMatch.getPlayer1Result().won && updatedMatch.getPlayer2Result().won) {
            // Winning tie - each player gets their entry fee back
            console.log('🤝 Winning tie - each player gets refund...');
            
            const entryFee = updatedMatch.entryFee;
            const feeAmount = entryFee * 0.05; // 5% fee
            
            const paymentInstructions = {
              winner: 'tie',
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              transactions: [
                {
                  from: updatedMatch.player1,
                  to: updatedMatch.player2,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 2'
                },
                {
                  from: updatedMatch.player1,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: updatedMatch.player1,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 2'
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = true;
            
            console.log('✅ Tie payment instructions created');
          } else {
          // Losing tie - both players get 95% refund via Squads
            console.log('🤝 Losing tie - processing 95% refunds to both players via Squads...');
            
            const entryFee = updatedMatch.entryFee;
            const refundAmount = entryFee * 0.95; // 95% refund to each player
            
            // Check if vault address exists
            if (!updatedMatch.squadsVaultAddress) {
              console.error('❌ Cannot create tie refund proposal: missing squadsVaultAddress', {
                matchId: updatedMatch.id,
                player1: updatedMatch.player1,
                player2: updatedMatch.player2,
              });
              throw new Error('Cannot create tie refund: missing squadsVaultAddress');
            }
            
            // Create Squads proposal for tie refund
            try {
              const refundResult = await squadsVaultService.proposeTieRefund(
                updatedMatch.squadsVaultAddress,
                new PublicKey(updatedMatch.player1),
                new PublicKey(updatedMatch.player2),
                refundAmount
              );
              
              if (refundResult.success) {
                console.log('✅ Squads tie refund proposal created:', refundResult.proposalId);
                
                // Update match with proposal information
                updatedMatch.payoutProposalId = refundResult.proposalId;
                updatedMatch.proposalCreatedAt = new Date();
                updatedMatch.proposalStatus = 'ACTIVE';
                updatedMatch.needsSignatures = 2; // 2-of-3 multisig
                updatedMatch.matchStatus = 'PROPOSAL_CREATED';
                
                // Save the match with proposal information
                await matchRepository.save(updatedMatch);
                console.log('✅ Match saved with tie refund proposal:', {
                  matchId: updatedMatch.id,
                  proposalId: refundResult.proposalId,
                  proposalStatus: 'ACTIVE',
                  needsSignatures: 2,
                });
                
                // Create payment instructions for display
                const paymentInstructions = {
                  winner: 'tie',
                  player1: updatedMatch.player1,
                  player2: updatedMatch.player2,
                  refundAmount: refundAmount,
                  feeAmount: entryFee * 0.05 * 2,
                  feeWallet: FEE_WALLET_ADDRESS,
                  squadsProposal: true,
                  proposalId: refundResult.proposalId,
                  transactions: [
                    {
                      from: 'Squads Vault',
                      to: updatedMatch.player1,
                      amount: refundAmount,
                      description: 'Losing tie refund (player 1)'
                    },
                    {
                      from: 'Squads Vault',
                      to: updatedMatch.player2,
                      amount: refundAmount,
                      description: 'Losing tie refund (player 2)'
                    }
                  ]
                };
                
                (payoutResult as any).paymentInstructions = paymentInstructions;
                (payoutResult as any).paymentSuccess = true;
                
              } else {
                console.error('❌ Squads tie refund proposal failed:', refundResult.error);
                throw new Error(`Squads proposal failed: ${refundResult.error}`);
              }
              
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.warn('⚠️ Squads tie refund proposal failed, falling back to manual instructions:', errorMessage);
              
              // Fallback to manual payment instructions
              const paymentInstructions = {
                winner: 'tie',
                player1: updatedMatch.player1,
                player2: updatedMatch.player2,
                refundAmount: refundAmount,
                feeAmount: entryFee * 0.05 * 2,
                feeWallet: FEE_WALLET_ADDRESS,
                squadsProposal: false,
                transactions: [
                  {
                    from: 'Squads Vault',
                    to: updatedMatch.player1,
                    amount: refundAmount,
                    description: 'Manual losing tie refund (player 1) - contact support'
                  },
                  {
                    from: 'Squads Vault',
                    to: updatedMatch.player2,
                    amount: refundAmount,
                    description: 'Manual losing tie refund (player 2) - contact support'
                  }
                ]
              };
              
              (payoutResult as any).paymentInstructions = paymentInstructions;
              (payoutResult as any).paymentSuccess = false;
              (payoutResult as any).paymentError = 'Squads proposal failed - contact support';
              
              console.log('⚠️ Manual losing tie refund instructions created');
            }
          }
        }
        
                  // Mark match as completed and ensure winner is set
          // IMPORTANT: Reload match to get latest proposal info before final save
          const finalMatch = await matchRepository.findOne({ where: { id: matchId } });
          if (finalMatch) {
            finalMatch.isCompleted = true;
            finalMatch.winner = payoutResult.winner; // Ensure winner is set from payout result
            finalMatch.setPayoutResult(payoutResult);
            // Preserve proposal fields if they were set earlier
            if ((updatedMatch as any).payoutProposalId) {
              (finalMatch as any).payoutProposalId = (updatedMatch as any).payoutProposalId;
              (finalMatch as any).proposalStatus = (updatedMatch as any).proposalStatus || 'ACTIVE';
              (finalMatch as any).proposalCreatedAt = (updatedMatch as any).proposalCreatedAt;
              (finalMatch as any).needsSignatures = (updatedMatch as any).needsSignatures || 2;
              console.log('✅ Preserving proposal fields in final save:', {
                matchId: finalMatch.id,
                proposalId: (finalMatch as any).payoutProposalId,
                proposalStatus: (finalMatch as any).proposalStatus,
                needsSignatures: (finalMatch as any).needsSignatures,
              });
            }
            await matchRepository.save(finalMatch);
            
            // CRITICAL: Ensure proposals are created after saving match
            // Create proposal directly if it doesn't exist (fixed missing service file issue)
            try {
              console.log('🔍 Checking if proposal needs to be created:', {
                matchId: finalMatch.id,
                hasPayoutProposalId: !!(finalMatch as any).payoutProposalId,
                hasTieRefundProposalId: !!(finalMatch as any).tieRefundProposalId,
                winner: finalMatch.winner,
                hasVaultAddress: !!(finalMatch as any).squadsVaultAddress,
              });
              
              // Check if proposal needs to be created - for tie games, winner is 'tie', for other games it's a wallet address
              const needsProposal = !(finalMatch as any).payoutProposalId && 
                                    !(finalMatch as any).tieRefundProposalId && 
                                    (finalMatch.winner || finalMatch.winner === 'tie') && 
                                    (finalMatch as any).squadsVaultAddress;
              
              if (needsProposal) {
                console.log('✅ Proposal creation conditions met, creating proposal...', {
                  matchId: finalMatch.id,
                  winner: finalMatch.winner,
                });
                
                const { PublicKey } = require('@solana/web3.js');
                const { SquadsVaultService } = require('../services/squadsVaultService');
                const squadsService = new SquadsVaultService();
                
                if (finalMatch.winner !== 'tie') {
                  // Winner payout proposal
                  const winner = finalMatch.winner;
                  const entryFee = finalMatch.entryFee;
                  const totalPot = entryFee * 2;
                  const winnerAmount = totalPot * 0.95;
                  const feeAmount = totalPot * 0.05;

                  const proposalResult = await squadsService.proposeWinnerPayout(
                    (finalMatch as any).squadsVaultAddress,
                    new PublicKey(winner),
                    winnerAmount,
                    new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                    feeAmount
                  );

                  if (proposalResult.success && proposalResult.proposalId) {
                    (finalMatch as any).payoutProposalId = proposalResult.proposalId;
                    (finalMatch as any).proposalCreatedAt = new Date();
                    (finalMatch as any).proposalStatus = 'ACTIVE';
                    (finalMatch as any).needsSignatures = proposalResult.needsSignatures || 1;
                    await matchRepository.save(finalMatch);
                    console.log('✅ Winner payout proposal created:', { matchId: finalMatch.id, proposalId: proposalResult.proposalId });
                  } else {
                    console.error('❌ Failed to create winner payout proposal:', proposalResult.error);
                  }
                } else {
                  // Tie refund proposal
                  console.log('🎯 Creating tie refund proposal...', { matchId: finalMatch.id });
                  const player1Result = finalMatch.getPlayer1Result();
                  const player2Result = finalMatch.getPlayer2Result();
                  const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
                  
                  console.log('🔍 Tie refund check:', {
                    matchId: finalMatch.id,
                    player1Result: player1Result ? { won: player1Result.won, numGuesses: player1Result.numGuesses } : null,
                    player2Result: player2Result ? { won: player2Result.won, numGuesses: player2Result.numGuesses } : null,
                    isLosingTie,
                  });
                  
                  if (isLosingTie) {
                    console.log('✅ Creating tie refund proposal for losing tie...', { matchId: finalMatch.id });
                    const entryFee = finalMatch.entryFee;
                    const refundAmount = entryFee * 0.95;
                    
                    const proposalResult = await squadsService.proposeTieRefund(
                      (finalMatch as any).squadsVaultAddress,
                      new PublicKey(finalMatch.player1),
                      new PublicKey(finalMatch.player2),
                      refundAmount
                    );

                    if (proposalResult.success && proposalResult.proposalId) {
                      (finalMatch as any).payoutProposalId = proposalResult.proposalId;
                      (finalMatch as any).tieRefundProposalId = proposalResult.proposalId;
                      (finalMatch as any).proposalCreatedAt = new Date();
                      (finalMatch as any).proposalStatus = 'ACTIVE';
                      (finalMatch as any).needsSignatures = proposalResult.needsSignatures || 1;
                      await matchRepository.save(finalMatch);
                      console.log('✅ Tie refund proposal created:', { matchId: finalMatch.id, proposalId: proposalResult.proposalId });
                    } else {
                      console.error('❌ Failed to create tie refund proposal:', proposalResult.error);
                    }
                  }
                }
              }
            } catch (proposalError: unknown) {
              const errorMessage = proposalError instanceof Error ? proposalError.message : String(proposalError);
              console.error('❌ Failed to create proposals after match completion:', errorMessage);
            }
          } else {
            // Fallback if reload fails
            updatedMatch.isCompleted = true;
            updatedMatch.winner = payoutResult.winner;
            updatedMatch.setPayoutResult(payoutResult);
            await matchRepository.save(updatedMatch);
            
            // CRITICAL: Ensure proposals are created for fallback save as well
            try {
              if (!(updatedMatch as any).payoutProposalId && !(updatedMatch as any).tieRefundProposalId && updatedMatch.winner && (updatedMatch as any).squadsVaultAddress) {
                const { PublicKey } = require('@solana/web3.js');
                const { SquadsVaultService } = require('../services/squadsVaultService');
                const squadsService = new SquadsVaultService();
                
                if (updatedMatch.winner !== 'tie') {
                  const winner = updatedMatch.winner;
                  const entryFee = updatedMatch.entryFee;
                  const totalPot = entryFee * 2;
                  const winnerAmount = totalPot * 0.95;
                  const feeAmount = totalPot * 0.05;

                  const proposalResult = await squadsService.proposeWinnerPayout(
                    (updatedMatch as any).squadsVaultAddress,
                    new PublicKey(winner),
                    winnerAmount,
                    new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                    feeAmount
                  );

                  if (proposalResult.success && proposalResult.proposalId) {
                    (updatedMatch as any).payoutProposalId = proposalResult.proposalId;
                    (updatedMatch as any).proposalCreatedAt = new Date();
                    (updatedMatch as any).proposalStatus = 'ACTIVE';
                    (updatedMatch as any).needsSignatures = proposalResult.needsSignatures || 1;
                    await matchRepository.save(updatedMatch);
                    console.log('✅ Winner payout proposal created (fallback):', { matchId: updatedMatch.id, proposalId: proposalResult.proposalId });
                  }
                } else {
                  const player1Result = updatedMatch.getPlayer1Result();
                  const player2Result = updatedMatch.getPlayer2Result();
                  const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
                  
                  if (isLosingTie) {
                    const entryFee = updatedMatch.entryFee;
                    const refundAmount = entryFee * 0.95;
                    
                    const proposalResult = await squadsService.proposeTieRefund(
                      (updatedMatch as any).squadsVaultAddress,
                      new PublicKey(updatedMatch.player1),
                      new PublicKey(updatedMatch.player2),
                      refundAmount
                    );

                    if (proposalResult.success && proposalResult.proposalId) {
                      (updatedMatch as any).payoutProposalId = proposalResult.proposalId;
                      (updatedMatch as any).tieRefundProposalId = proposalResult.proposalId;
                      (updatedMatch as any).proposalCreatedAt = new Date();
                      (updatedMatch as any).proposalStatus = 'ACTIVE';
                      (updatedMatch as any).needsSignatures = proposalResult.needsSignatures || 1;
                      await matchRepository.save(updatedMatch);
                      console.log('✅ Tie refund proposal created (fallback):', { matchId: updatedMatch.id, proposalId: proposalResult.proposalId });
                    }
                  }
                }
              }
            } catch (proposalError: unknown) {
              const errorMessage = proposalError instanceof Error ? proposalError.message : String(proposalError);
              console.error('❌ Failed to create proposals for fallback save:', errorMessage);
            }
          }
          
          // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
          markGameCompleted(matchId);
        
        res.json({
          status: 'completed',
          winner: (payoutResult as any).winner,
          payout: payoutResult,
          message: 'Game completed - winner determined'
        });
      } else {
        // Both players haven't finished yet - save partial result and wait
        console.log('⏳ Not all players finished yet (non-solved case), waiting for other player');
        await matchRepository.save(match);
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player to finish'
        });
      }
    }

  } catch (error: unknown) {
    console.error('❌ Error submitting result:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getMatchStatusHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;
    
    console.log('🔍 Looking up match status for:', matchId);
    
    // Try to find match in database first
    let match = null;
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      match = await matchRepository.findOne({ where: { id: matchId } });
      if (match) {
    
      }
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn('⚠️ Database lookup failed:', dbErrorMessage);
    }
    
    // If not found in database, check Redis matchmaking service
    if (!match) {
      console.log('🔍 Checking Redis matchmaking service...');
      try {
        const { redisMatchmakingService } = require('../services/redisMatchmakingService');
        const redisMatch = await redisMatchmakingService.getMatch(matchId);
        if (redisMatch) {
          console.log('✅ Found match in Redis matchmaking service');
          // Convert Redis match data to database match format
          match = {
            id: redisMatch.matchId,
            player1: redisMatch.player1,
            player2: redisMatch.player2,
            entryFee: redisMatch.entryFee,
            status: redisMatch.status,
            word: (redisMatch as any).word || null,
            createdAt: new Date(redisMatch.createdAt),
            updatedAt: new Date(redisMatch.createdAt), // Use createdAt as updatedAt for Redis matches
            // Add payment status fields (default to false for new matches)
            player1Paid: (redisMatch as any).player1Paid || false,
            player2Paid: (redisMatch as any).player2Paid || false,
            payoutResult: (redisMatch as any).payoutResult || null,
            // Add methods that the frontend expects
            getPlayer1Result: () => {
              const result = (redisMatch as any).player1Result;
              if (!result) return null;
              try {
                return JSON.parse(result);
              } catch {
                return null;
              }
            },
            getPlayer2Result: () => {
              const result = (redisMatch as any).player2Result;
              if (!result) return null;
              try {
                return JSON.parse(result);
              } catch {
                return null;
              }
            },
            getPayoutResult: () => {
              const result = (redisMatch as any).payoutResult;
              if (!result) return null;
              try {
                return JSON.parse(result);
              } catch {
                return null;
              }
            },
            isCompleted: redisMatch.status === 'completed',
            winner: (redisMatch as any).winner || null
          };
        } else {
          console.log('❌ Match not found in database or Redis matchmaking service');
          return res.status(404).json({ error: 'Match not found' });
        }
      } catch (redisError: unknown) {
        const redisErrorMessage = redisError instanceof Error ? redisError.message : String(redisError);
        console.warn('⚠️ Redis matchmaking service lookup failed:', redisErrorMessage);
        console.log('❌ Match not found in database or Redis');
        return res.status(404).json({ error: 'Match not found' });
      }
    }

    // Auto-create Squads vault if missing and match requires escrow
    try {
      if (match && !(match as any).squadsVaultAddress && ['payment_required', 'matched', 'escrow', 'active'].includes(match.status)) {
        console.log('🏦 No vault on match yet; attempting on-demand creation...', { matchId: match.id });
        const creation = await squadsVaultService.createMatchVault(
          match.id,
          new PublicKey(match.player1),
          new PublicKey(match.player2),
          match.entryFee
        );
        if (creation?.success && creation.vaultAddress) {
          const { AppDataSource } = require('../db/index');
          const matchRepository = AppDataSource.getRepository(Match);
          (match as any).squadsVaultAddress = creation.vaultAddress;
          await matchRepository.update({ id: match.id }, { squadsVaultAddress: creation.vaultAddress, matchStatus: 'VAULT_CREATED' });
          console.log('✅ Vault created on-demand for match', { matchId: match.id, vault: creation.vaultAddress });
        }
      }
    } catch (onDemandErr) {
      console.warn('⚠️ On-demand vault creation failed (will retry on next poll)', {
        matchId: match?.id,
        error: onDemandErr instanceof Error ? onDemandErr.message : String(onDemandErr)
      });
    }

    // Check if this match already has results for the requesting player
    const requestingWallet = req.query.wallet || req.headers['x-wallet'];
    const isPlayer1 = match.player1 === requestingWallet;
    const existingResult = isPlayer1 ? match.getPlayer1Result() : match.getPlayer2Result();
    
    // Determine the appropriate status based on the requesting player's payment status
    let playerSpecificStatus = match.status;
    
    if (match.status === 'payment_required') {
      const requestingPlayerPaid = isPlayer1 ? match.player1Paid : match.player2Paid;
      const otherPlayerPaid = isPlayer1 ? match.player2Paid : match.player1Paid;
      
      if (requestingPlayerPaid && otherPlayerPaid) {
        // Both players have paid
        playerSpecificStatus = 'active';
      } else if (requestingPlayerPaid && !otherPlayerPaid) {
        // Requesting player has paid, waiting for other player
        playerSpecificStatus = 'waiting_for_payment';
      } else if (!requestingPlayerPaid) {
        // Requesting player hasn't paid yet
        playerSpecificStatus = 'payment_required';
      }
    }
    
    console.log('✅ Returning match data:', {
      status: playerSpecificStatus,
      originalStatus: match.status,
      player1: match.player1,
      player2: match.player2,
      hasWord: !!match.word,
      requestingWallet,
      isPlayer1,
      requestingPlayerPaid: isPlayer1 ? match.player1Paid : match.player2Paid,
      otherPlayerPaid: isPlayer1 ? match.player2Paid : match.player1Paid,
      hasExistingResult: !!existingResult,
      player1Result: match.getPlayer1Result(),
      player2Result: match.getPlayer2Result(),
      winner: match.winner,
      isCompleted: match.isCompleted
    });

    // If match has existing results, mark it as completed
    if (existingResult) {
      playerSpecificStatus = 'completed';
      match.isCompleted = true;
    }

  // If match is completed but winner is missing, OR both players have results but match isn't marked completed, recalculate and save it
  const player1Result = match.getPlayer1Result();
  const player2Result = match.getPlayer2Result();
  const bothHaveResults = !!player1Result && !!player2Result;
  const shouldRecalculate = (match.isCompleted && !match.winner) || (bothHaveResults && (!match.isCompleted || !match.winner));
  
  if (shouldRecalculate) {
    console.log('⚠️ Match needs winner calculation - recalculating...', { 
      matchId: match.id,
      isCompleted: match.isCompleted,
      hasWinner: !!match.winner,
      bothHaveResults
    });
    
    if (player1Result && player2Result) {
      try {
        const recalculatedPayout = await determineWinnerAndPayout(match.id, player1Result, player2Result);
        // Reload match to get the updated winner and all fields
        const { AppDataSource } = require('../db/index');
        const matchRepository = AppDataSource.getRepository(Match);
        const reloadedMatch = await matchRepository.findOne({ where: { id: match.id } });
        if (reloadedMatch) {
          match.winner = reloadedMatch.winner;
          const reloadedPayoutResult = reloadedMatch.getPayoutResult();
          if (reloadedPayoutResult) {
            match.setPayoutResult(reloadedPayoutResult);
          }
          // Copy proposal fields
          (match as any).payoutProposalId = (reloadedMatch as any).payoutProposalId;
          (match as any).proposalStatus = (reloadedMatch as any).proposalStatus;
          (match as any).proposalCreatedAt = (reloadedMatch as any).proposalCreatedAt;
          (match as any).needsSignatures = (reloadedMatch as any).needsSignatures;
          console.log('✅ Winner recalculated and saved:', { 
            matchId: match.id, 
            winner: match.winner,
            payoutProposalId: (match as any).payoutProposalId
          });
          
          // If payout proposal is missing, create it based on match outcome
          if (!(match as any).payoutProposalId && !(match as any).tieRefundProposalId && match.winner && (match as any).squadsVaultAddress) {
            console.log('⚠️ Payout proposal missing, creating now...', { matchId: match.id, winner: match.winner });
            try {
              const { PublicKey } = require('@solana/web3.js');
              const { squadsVaultService } = require('../services/squadsVaultService');
              
              if (match.winner !== 'tie') {
                // Winner payout proposal
                const winner = match.winner;
                const entryFee = match.entryFee;
                const totalPot = entryFee * 2;
                const winnerAmount = totalPot * 0.95;
                const feeAmount = totalPot * 0.05;

                const proposalResult = await squadsVaultService.proposeWinnerPayout(
                  (match as any).squadsVaultAddress,
                  new PublicKey(winner),
                  winnerAmount,
                  new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                  feeAmount
                );

                if (proposalResult.success) {
                  (match as any).payoutProposalId = proposalResult.proposalId;
                  (match as any).proposalCreatedAt = new Date();
                  (match as any).proposalStatus = 'ACTIVE';
                  (match as any).needsSignatures = proposalResult.needsSignatures || 1; // System auto-signs, so 1 more needed
                  await matchRepository.save(match);
                  console.log('✅ Payout proposal created for missing winner:', { matchId: match.id, proposalId: proposalResult.proposalId });
                }
              } else {
                // Tie refund proposal
                const player1Result = match.getPlayer1Result();
                const player2Result = match.getPlayer2Result();
                const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
                
                if (isLosingTie) {
                  const entryFee = match.entryFee;
                  const refundAmount = entryFee * 0.95; // 95% refund
                  
                  console.log('🔄 Attempting to create tie refund proposal', {
                    matchId: match.id,
                    vaultAddress: (match as any).squadsVaultAddress,
                    player1: match.player1,
                    player2: match.player2,
                    refundAmount,
                  });
                  
                  const proposalResult = await squadsVaultService.proposeTieRefund(
                    (match as any).squadsVaultAddress,
                    new PublicKey(match.player1),
                    new PublicKey(match.player2),
                    refundAmount
                  );

                  if (proposalResult.success && proposalResult.proposalId) {
                    (match as any).payoutProposalId = proposalResult.proposalId;
                    (match as any).tieRefundProposalId = proposalResult.proposalId;
                    (match as any).proposalCreatedAt = new Date();
                    (match as any).proposalStatus = 'ACTIVE';
                    (match as any).needsSignatures = proposalResult.needsSignatures || 1; // System auto-signs, so 1 more needed
                    await matchRepository.save(match);
                    console.log('✅ Tie refund proposal created:', { matchId: match.id, proposalId: proposalResult.proposalId });
                    
                    // Reload match to ensure we have the latest proposal data
                    const reloadedMatch = await matchRepository.findOne({ where: { id: match.id } });
                    if (reloadedMatch) {
                      (match as any).payoutProposalId = (reloadedMatch as any).payoutProposalId;
                      (match as any).tieRefundProposalId = (reloadedMatch as any).tieRefundProposalId;
                      (match as any).proposalStatus = (reloadedMatch as any).proposalStatus;
                      (match as any).proposalCreatedAt = (reloadedMatch as any).proposalCreatedAt;
                      (match as any).needsSignatures = (reloadedMatch as any).needsSignatures;
                    }
                  } else {
                    console.error('❌ Failed to create tie refund proposal:', {
                      matchId: match.id,
                      success: proposalResult.success,
                      proposalId: proposalResult.proposalId,
                      error: proposalResult.error,
                      needsSignatures: proposalResult.needsSignatures,
                    });
                  }
                } else {
                  console.warn('⚠️ Tie detected but isLosingTie check failed:', {
                    matchId: match.id,
                    player1Result: player1Result ? { won: player1Result.won, numGuesses: player1Result.numGuesses } : null,
                    player2Result: player2Result ? { won: player2Result.won, numGuesses: player2Result.numGuesses } : null,
                  });
                }
              }
            } catch (proposalError: unknown) {
              const errorMessage = proposalError instanceof Error ? proposalError.message : String(proposalError);
              console.error('❌ Error creating payout proposal:', errorMessage);
            }
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Error recalculating winner:', errorMessage);
      }
    }
  }

  // Get payout result and ensure refund signatures are included
  let payoutResult = match.getPayoutResult();
  if (payoutResult && (match.player1RefundSignature || match.player2RefundSignature)) {
    // Add refund signatures from database if not already in payout result
    if (!payoutResult.player1RefundSignature && match.player1RefundSignature) {
      payoutResult.player1RefundSignature = match.player1RefundSignature;
    }
    if (!payoutResult.player2RefundSignature && match.player2RefundSignature) {
      payoutResult.player2RefundSignature = match.player2RefundSignature;
    }
  }

  // FINAL FALLBACK: If proposal is still missing and match is completed, create it now
  // This ensures proposals are created even if the earlier code paths didn't execute
  // CRITICAL: Reload match from database to ensure we have the latest vault address
  // The vault might have been created after the match was initially loaded
  let freshMatch = match;
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const reloaded = await matchRepository.findOne({ where: { id: match.id } });
    if (reloaded) {
      freshMatch = reloaded;
      // Copy any methods that might be missing
      if (!freshMatch.getPlayer1Result) {
        freshMatch.getPlayer1Result = match.getPlayer1Result;
      }
      if (!freshMatch.getPlayer2Result) {
        freshMatch.getPlayer2Result = match.getPlayer2Result;
      }
      if (!freshMatch.getPayoutResult) {
        freshMatch.getPayoutResult = match.getPayoutResult;
      }
    }
  } catch (reloadError) {
    console.warn('⚠️ Failed to reload match for final fallback, using cached match:', reloadError);
  }
  
  // Log current state for debugging
  console.log('🔍 FINAL FALLBACK CHECK:', {
    matchId: freshMatch.id,
    isCompleted: freshMatch.isCompleted,
    winner: freshMatch.winner,
    hasPayoutProposalId: !!(freshMatch as any).payoutProposalId,
    hasTieRefundProposalId: !!(freshMatch as any).tieRefundProposalId,
    hasSquadsVaultAddress: !!(freshMatch as any).squadsVaultAddress,
    squadsVaultAddress: (freshMatch as any).squadsVaultAddress,
    player1Result: freshMatch.getPlayer1Result() ? { won: freshMatch.getPlayer1Result()?.won } : null,
    player2Result: freshMatch.getPlayer2Result() ? { won: freshMatch.getPlayer2Result()?.won } : null,
  });
  
  // More lenient check: if match has results and winner is 'tie', try to create proposal
  const hasResults = freshMatch.getPlayer1Result() && freshMatch.getPlayer2Result();
  const isTieMatch = freshMatch.winner === 'tie';
  const needsProposal = !(freshMatch as any).payoutProposalId && !(freshMatch as any).tieRefundProposalId;
  const hasVault = !!(freshMatch as any).squadsVaultAddress;
  
  if (hasResults && isTieMatch && needsProposal && hasVault) {
    
    console.log('🔄 FINAL FALLBACK: Creating missing proposal before response', {
      matchId: freshMatch.id,
      winner: freshMatch.winner,
      isCompleted: freshMatch.isCompleted,
      hasVault: hasVault,
      hasResults: hasResults,
      squadsVaultAddress: (freshMatch as any).squadsVaultAddress
    });
    
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      const { PublicKey } = require('@solana/web3.js');
      const { squadsVaultService } = require('../services/squadsVaultService');
      
      if (freshMatch.winner === 'tie') {
        const player1Result = freshMatch.getPlayer1Result();
        const player2Result = freshMatch.getPlayer2Result();
        const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
        
        if (isLosingTie) {
          const entryFee = freshMatch.entryFee;
          const refundAmount = entryFee * 0.95;
          
          console.log('🔄 FINAL FALLBACK: Creating tie refund proposal', {
            matchId: freshMatch.id,
            refundAmount,
            player1: freshMatch.player1,
            player2: freshMatch.player2,
            squadsVaultAddress: (freshMatch as any).squadsVaultAddress
          });
          
          const proposalResult = await squadsVaultService.proposeTieRefund(
            (freshMatch as any).squadsVaultAddress,
            new PublicKey(freshMatch.player1),
            new PublicKey(freshMatch.player2),
            refundAmount
          );
          
          if (proposalResult.success && proposalResult.proposalId) {
            // Update match with proposal data
            (freshMatch as any).payoutProposalId = proposalResult.proposalId;
            (freshMatch as any).tieRefundProposalId = proposalResult.proposalId;
            (freshMatch as any).proposalCreatedAt = new Date();
            (freshMatch as any).proposalStatus = 'ACTIVE';
            (freshMatch as any).needsSignatures = proposalResult.needsSignatures || 1;
            
            // Ensure match is marked as completed
            if (!freshMatch.isCompleted) {
              freshMatch.isCompleted = true;
            }
            
            // Save match
            await matchRepository.save(freshMatch);
            
            // Reload to ensure we have the latest data and update the match reference
            const reloadedMatch = await matchRepository.findOne({ where: { id: freshMatch.id } });
            if (reloadedMatch) {
              Object.assign(match, reloadedMatch);
              (match as any).payoutProposalId = (reloadedMatch as any).payoutProposalId;
              (match as any).tieRefundProposalId = (reloadedMatch as any).tieRefundProposalId;
              (match as any).proposalStatus = (reloadedMatch as any).proposalStatus;
              (match as any).proposalCreatedAt = (reloadedMatch as any).proposalCreatedAt;
              (match as any).needsSignatures = (reloadedMatch as any).needsSignatures;
              match.isCompleted = reloadedMatch.isCompleted;
            }
            
            console.log('✅ FINAL FALLBACK: Tie refund proposal created and saved successfully', {
              matchId: freshMatch.id,
              proposalId: proposalResult.proposalId,
              proposalStatus: (match as any).proposalStatus,
              needsSignatures: (match as any).needsSignatures
            });
          } else {
            console.error('❌ FINAL FALLBACK: Failed to create tie refund proposal', {
              matchId: match.id,
              success: proposalResult.success,
              proposalId: proposalResult.proposalId,
              error: proposalResult.error,
              needsSignatures: proposalResult.needsSignatures
            });
          }
        }
      }
    } catch (fallbackError: unknown) {
      const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.error('❌ FINAL FALLBACK: Error creating proposal', {
        matchId: match.id,
        error: errorMessage
      });
    }
  }

  res.json({
    status: playerSpecificStatus,
      player1: match.player1,
      player2: match.player2,
      squadsVaultAddress: (match as any).squadsVaultAddress || (match as any).vaultAddress || null,
      vaultAddress: (match as any).squadsVaultAddress || (match as any).vaultAddress || null,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      word: match.word,
      player1Result: match.getPlayer1Result(),
      player2Result: match.getPlayer2Result(),
      winner: match.winner,
      payout: payoutResult,
      isCompleted: match.isCompleted || !!existingResult,
      payoutProposalId: (match as any).payoutProposalId || null,
      tieRefundProposalId: (match as any).tieRefundProposalId || null,
      proposalStatus: (match as any).proposalStatus || null,
      proposalCreatedAt: (match as any).proposalCreatedAt || null,
      needsSignatures: (match as any).needsSignatures || 0,
      proposalSigners: (match as any).proposalSigners || [],
      proposalExecutedAt: (match as any).proposalExecutedAt || null,
      proposalTransactionId: (match as any).proposalTransactionId || null
    });

  } catch (error: unknown) {
    console.error('❌ Error getting match status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Check for pending winnings/refunds for a player
const checkPendingClaimsHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'Valid wallet address required' });
    }

    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in checkPendingClaimsHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }

    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find matches where player has pending winnings (completed matches with active proposals)
    const pendingWinnings = await matchRepository
      .createQueryBuilder('match')
      .where('match.isCompleted = :completed', { completed: true })
      .andWhere('match.winner != :tie', { tie: 'tie' })
      .andWhere('match.winner IS NOT NULL')
      .andWhere('match.payoutProposalId IS NOT NULL')
      .andWhere('(match.proposalStatus = :proposalStatus OR match.proposalStatus IS NULL)', { proposalStatus: 'ACTIVE' })
      .andWhere('match.needsSignatures > 0')
      .andWhere('(match.player1 = :wallet OR match.player2 = :wallet)', { wallet })
      .getMany();

    // Find matches where player has pending refunds (tie/timeout but proposal not executed)
    const pendingRefunds = await matchRepository
      .createQueryBuilder('match')
      .where('match.isCompleted = :completed', { completed: true })
      .andWhere('match.winner = :tie', { tie: 'tie' })
      .andWhere('match.payoutProposalId IS NOT NULL')
      .andWhere('(match.proposalStatus = :proposalStatus OR match.proposalStatus IS NULL)', { proposalStatus: 'ACTIVE' })
      .andWhere('match.needsSignatures > 0')
      .andWhere('(match.player1 = :wallet OR match.player2 = :wallet)', { wallet })
      .getMany();

    // Check if player has any pending claims
    const hasPendingWinnings = pendingWinnings.length > 0;
    const hasPendingRefunds = pendingRefunds.length > 0;
    const hasAnyPendingClaims = hasPendingWinnings || hasPendingRefunds;

    // For refunds, check if ANY player has signed (refund can be executed by either player)
    let refundCanBeExecuted = false;
    if (hasPendingRefunds) {
      for (const refundMatch of pendingRefunds) {
        try {
          const signers = refundMatch.getProposalSigners ? refundMatch.getProposalSigners() : [];
          if (signers.length > 0) {
            refundCanBeExecuted = true;
            break;
          }
        } catch (err) {
          console.warn('Error getting proposal signers for match', refundMatch.id, err);
        }
      }
    }

    res.json({
      hasPendingClaims: hasAnyPendingClaims,
      hasPendingWinnings,
      hasPendingRefunds,
      refundCanBeExecuted,
      pendingWinnings: pendingWinnings.map(match => {
        let isWinner = false;
        if (match.payoutProposalId) {
          try {
            const player1Result = match.getPlayer1Result();
            const player2Result = match.getPlayer2Result();
            if (match.player1 === wallet && player1Result && player2Result) {
              isWinner = player1Result.numGuesses < player2Result.numGuesses;
            } else if (match.player2 === wallet && player1Result && player2Result) {
              isWinner = player2Result.numGuesses < player1Result.numGuesses;
            }
          } catch (err) {
            console.warn('Error determining winner for match', match.id, err);
          }
        }
        return {
          matchId: match.id,
          entryFee: match.entryFee,
          proposalId: match.payoutProposalId,
          proposalCreatedAt: match.proposalCreatedAt,
          needsSignatures: match.needsSignatures,
          isWinner
        };
      }),
      pendingRefunds: pendingRefunds.map(match => ({
        matchId: match.id,
        entryFee: match.entryFee,
        proposalId: match.payoutProposalId,
        proposalCreatedAt: match.proposalCreatedAt,
        needsSignatures: match.needsSignatures,
        refundAmount: match.entryFee * 0.95 // 95% refund for ties
      }))
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error checking pending claims:', errorMessage);
    console.error('❌ Error stack:', errorStack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

// Check if a player has been matched (for polling)
const checkPlayerMatchHandler = async (req: any, res: any) => {
  try {
    // Ensure database is initialized
    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in checkPlayerMatchHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }

    const { wallet, walletAddress } = req.params;
    const walletParam = wallet || walletAddress;
    
    console.log('🔍 Checking if player has been matched:', walletParam);
    
    if (!walletParam) {
      console.log('❌ No wallet provided in request');
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Check for active matches with this player using raw SQL
    let activeMatches = [];
    let cancelledMatches = [];
    
    try {
      activeMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "player2",
          status,
          "player1Paid",
          "player2Paid",
          word,
          "squadsVaultAddress",
          "entryFee"
        FROM "match" 
        WHERE (("player1" = $1 OR "player2" = $2) AND "status" IN ($3, $4, $5, $6))
        LIMIT 1
      `, [walletParam, walletParam, 'active', 'escrow', 'matched', 'payment_required']);

      // Also check for cancelled matches
      cancelledMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "player2",
          status
        FROM "match" 
        WHERE (("player1" = $1 OR "player2" = $2) AND "status" = $3)
        LIMIT 1
      `, [walletParam, walletParam, 'cancelled']);
      
      console.log('✅ Database queries completed successfully');
    } catch (dbError: unknown) {
      console.error('❌ Database query error:', dbError);
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      const dbErrorStack = dbError instanceof Error ? dbError.stack : undefined;
      const dbErrorName = dbError instanceof Error ? dbError.name : undefined;
      console.error('❌ Error details:', {
        message: dbErrorMessage,
        stack: dbErrorStack,
        code: dbErrorName
      });
      return res.status(500).json({ error: 'Database query failed' });
    }
    
    if (activeMatches.length > 0) {
      const activeMatch = activeMatches[0];
      console.log('✅ Player has been matched:', {
        matchId: activeMatch.id,
        player1: activeMatch.player1,
        player2: activeMatch.player2,
        status: activeMatch.status,
        requestingWallet: wallet
      });
      
      // Also log all matches for this player for debugging
      let allPlayerMatches = [];
      try {
        allPlayerMatches = await matchRepository.query(`
          SELECT 
            id,
            status,
            "player1",
            "player2"
          FROM "match" 
          WHERE "player1" = $1 OR "player2" = $2
        `, [wallet, wallet]);
      } catch (debugError) {
        console.error('❌ Error fetching debug matches:', debugError);
        // Don't fail the request for debug data
      }
      
      console.log('🔍 All matches for player:', allPlayerMatches.map((m: any) => ({
        id: m.id,
        status: m.status,
        player1: m.player1,
        player2: m.player2
      })));
      
      // Determine the appropriate message based on status
      let message = '';
      if (activeMatch.status === 'escrow' || activeMatch.status === 'matched' || activeMatch.status === 'payment_required') {
        message = 'Match created - please pay your entry fee';
      } else if (activeMatch.status === 'active') {
        message = 'Already in active match';
      }
      
      res.json({
        matched: true,
        matchId: activeMatch.id,
        status: activeMatch.status,
        player1: activeMatch.player1,
        player2: activeMatch.player2,
        player1Paid: activeMatch.player1Paid,
        player2Paid: activeMatch.player2Paid,
        word: activeMatch.word,
        vaultAddress: activeMatch.squadsVaultAddress,
        entryFee: activeMatch.entryFee,
        message: message
      });
    } else if (cancelledMatches.length > 0) {
      const cancelledMatch = cancelledMatches[0];
      console.log('❌ Player has cancelled match:', {
        matchId: cancelledMatch.id,
        player1: cancelledMatch.player1,
        player2: cancelledMatch.player2,
        status: cancelledMatch.status
      });
      
      res.json({
        matched: false,
        status: 'cancelled',
        message: 'Match was cancelled due to payment timeout'
      });
    } else {
      console.log('⏳ Player still waiting for match');
      
      // Check if there are any waiting matches this player could join
      let availableWaitingMatches = [];
      try {
        availableWaitingMatches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            "entryFee"
          FROM "match" 
          WHERE "status" = $1 AND "player2" IS NULL AND "player1" != $2
          ORDER BY "createdAt" ASC
          LIMIT 1
        `, ['waiting', wallet]);
      } catch (waitingError) {
        console.error('❌ Error checking waiting matches:', waitingError);
        // Continue without failing the request
      }
      
      if (availableWaitingMatches.length > 0) {
        const availableWaitingMatch = availableWaitingMatches[0];
        console.log('🎯 Found available waiting match, but not creating duplicate - Redis handles matchmaking:', {
          waitingEntryId: availableWaitingMatch.id,
          waitingPlayer: availableWaitingMatch.player1,
          entryFee: availableWaitingMatch.entryFee,
          requestingPlayer: wallet
        });
        
        // Don't create matches here - let Redis handle all matchmaking
        // This prevents duplicate matches from being created
      }
      
      // Also check for waiting matches to debug using raw SQL
      let waitingMatches = [];
      try {
        waitingMatches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            status
          FROM "match" 
          WHERE "player1" = $1 AND "status" = $2 AND "player2" IS NULL
          LIMIT 1
        `, [wallet, 'waiting']);
      } catch (waitingDebugError) {
        console.error('❌ Error checking waiting matches for debug:', waitingDebugError);
        // Don't fail the request for debug data
      }
      
      if (waitingMatches.length > 0) {
        const waitingMatch = waitingMatches[0];
        console.log('🔍 Player has waiting entry:', {
          matchId: waitingMatch.id,
          player1: waitingMatch.player1,
          status: waitingMatch.status
        });
      }
      
      // Check if player is waiting in Redis
      try {
        const { redisMatchmakingService } = require('../services/redisMatchmakingService');
        const redisMatch = await redisMatchmakingService.getPlayerMatch(walletParam);
        if (redisMatch) {
          console.log('🔍 Player has Redis match:', {
            matchId: redisMatch.matchId,
            player1: redisMatch.player1,
            player2: redisMatch.player2,
            status: redisMatch.status
          });
          
          // Return the Redis match data
          return res.json({ 
            matched: true, 
            matchId: redisMatch.matchId,
            player1: redisMatch.player1,
            player2: redisMatch.player2,
            entryFee: redisMatch.entryFee,
            status: redisMatch.status
          });
        }
      } catch (redisError) {
        console.error('❌ Error checking Redis match:', redisError);
        // Continue without failing the request
      }
      
      res.json({ matched: false });
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error checking player match:', errorMessage);
    console.error('❌ Error stack:', errorStack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

// Confirm escrow payment and activate game
const confirmEscrowHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, escrowSignature } = req.body;
    
    console.log('💰 Confirming escrow payment:', { matchId, wallet, escrowSignature });
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find the match
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    if (match.status !== 'escrow') {
      return res.status(400).json({ error: 'Match is not in escrow status' });
    }
    
    if (match.player1 !== wallet && match.player2 !== wallet) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }
    
    // Update match to track escrow confirmations
    if (match.player1 === wallet) {
      match.player1EscrowConfirmed = true;
      match.player1EscrowSignature = escrowSignature;
    } else {
      match.player2EscrowConfirmed = true;
      match.player2EscrowSignature = escrowSignature;
    }
    
    // Check if both players have confirmed escrow
    if (match.player1EscrowConfirmed && match.player2EscrowConfirmed) {
      console.log('✅ Both players confirmed escrow, activating game');
      match.status = 'active';
      match.gameStartTime = new Date();
    }
    
    await matchRepository.save(match);
    
    res.json({
      success: true,
      status: match.status,
      message: match.status === 'active' ? 'Game activated!' : 'Escrow confirmed, waiting for opponent'
    });
    
  } catch (error: unknown) {
    console.error('❌ Error confirming escrow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Server-side game guess tracking endpoint
const submitGameGuessHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, guess } = req.body;
    
    if (!matchId || !wallet || !guess) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate guess format (5 letters)
    if (!/^[A-Z]{5}$/.test(guess)) {
      return res.status(400).json({ error: 'Invalid guess format - must be 5 letters' });
    }

    // Allow any 5-letter word (no word list validation)
    // The game is about guessing, not about using specific words

    // Get server-side game state from Redis
    const serverGameState = await getGameState(matchId as string);
    if (!serverGameState) {
      return res.status(404).json({ error: 'Game not found or already completed' });
    }

    // Validate player is part of this match
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;

    // Check if player already solved
    if (isPlayer1 && serverGameState.player1Solved) {
      return res.status(400).json({ error: 'Player 1 already solved the puzzle' });
    }
    if (!isPlayer1 && serverGameState.player2Solved) {
      return res.status(400).json({ error: 'Player 2 already solved the puzzle' });
    }

    // Check guess limit (7 guesses)
    if (playerGuesses.length >= 7) {
      return res.status(400).json({ error: 'Maximum 7 guesses reached' });
    }

    // Add guess to server state
    playerGuesses.push(guess);

    // Check if this guess solves the puzzle
    const solved = guess === serverGameState.word;
    if (isPlayer1) {
      serverGameState.player1Solved = solved;
    } else {
      serverGameState.player2Solved = solved;
    }
    
    // Save updated game state to Redis
    await setGameState(matchId as string, serverGameState);

    console.log(`📝 Server recorded guess for ${isPlayer1 ? 'Player 1' : 'Player 2'}:`, {
      matchId,
      wallet,
      guess,
      solved,
      totalGuesses: playerGuesses.length
    });

    res.json({
      success: true,
      guess,
      solved,
      totalGuesses: playerGuesses.length,
      remainingGuesses: 7 - playerGuesses.length
    });

  } catch (error: unknown) {
    console.error('❌ Error submitting guess:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Add server-side game state endpoint
const getGameStateHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet } = req.query;
    
    if (!matchId || !wallet) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate player is part of this match first
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Get server-side game state from Redis
    const serverGameState = await getGameState(matchId as string);
    if (!serverGameState) {
      console.log(`❌ Game state not found for match ${matchId}`);
      console.log(`🔍 Active games: Check Redis for game states`);
      console.log(`🔍 Match status:`, match?.status);
      console.log(`🔍 Match completed:`, match?.isCompleted);
      
      // If match is completed, return completion status
      if (match?.isCompleted) {
        console.log(`✅ Match ${matchId} is completed, returning completion status`);
        return res.json({
          success: true,
          gameCompleted: true,
          matchCompleted: true,
          message: 'Game completed - results available'
        });
      }
      
      // If match is active but no game state, try to reinitialize
      if (match?.status === 'active') {
        console.log(`🔄 Attempting to reinitialize game state for match ${matchId}`);
        const word = getRandomWord();
        const newGameState = {
          startTime: Date.now(),
          player1StartTime: Date.now(),
          player2StartTime: Date.now(),
          player1Guesses: [],
          player2Guesses: [],
          player1Solved: false,
          player2Solved: false,
          word: word,
          matchId: matchId,
          lastActivity: Date.now(),
          completed: false
        };
        
        // Update match directly in database
        if (!match.word) {
          match.word = word;
        }
        if (!match.gameStartTime) {
          match.gameStartTime = new Date();
        }
        await matchRepository.save(match);
        
        await setGameState(matchId as string, newGameState);
        console.log(`✅ Reinitialized game state for match ${matchId}`);
        
        // Use the new game state
        const reinitializedGameState = await getGameState(matchId as string);
        if (reinitializedGameState) {
          const isPlayer1 = wallet === match.player1;
          const playerGuesses = isPlayer1 ? reinitializedGameState.player1Guesses : reinitializedGameState.player2Guesses;
          
          // Game should remain active until BOTH players have finished
          // Don't check database results - game should remain active until both players finish guessing
          const bothPlayersFinished = (reinitializedGameState.player1Solved || reinitializedGameState.player1Guesses.length >= 7) && 
                                     (reinitializedGameState.player2Solved || reinitializedGameState.player2Guesses.length >= 7);
          
          return res.json({
            success: true,
            playerGuesses,
            totalGuesses: playerGuesses.length,
            remainingGuesses: 7 - playerGuesses.length,
            solved: isPlayer1 ? reinitializedGameState.player1Solved : reinitializedGameState.player2Solved,
            opponentSolved: isPlayer1 ? reinitializedGameState.player2Solved : reinitializedGameState.player1Solved,
            gameActive: !bothPlayersFinished, // Game active until both players finish
            targetWord: reinitializedGameState.word, // Include target word for color calculation
            gameCompleted: bothPlayersFinished // New field to indicate when both players are done
          });
        }
      }
      
      return res.status(404).json({ error: 'Game not found or already completed' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    const opponentGuesses = isPlayer1 ? serverGameState.player2Guesses : serverGameState.player1Guesses;

    // Check if match is completed in database (more authoritative than Redis)
    const matchCompleted = match.isCompleted || false;
    
    // Return safe game state (don't reveal the word or opponent's guesses)
    // Game should remain active until BOTH players have finished (solved or run out of guesses)
    // Also check database results to ensure completion status is accurate
    const player1Result = match.getPlayer1Result();
    const player2Result = match.getPlayer2Result();
    const bothPlayersFinished = (serverGameState.player1Solved || serverGameState.player1Guesses.length >= 7 || !!player1Result) && 
                               (serverGameState.player2Solved || serverGameState.player2Guesses.length >= 7 || !!player2Result);
    
    res.json({
      success: true,
      playerGuesses,
      totalGuesses: playerGuesses.length,
      remainingGuesses: 7 - playerGuesses.length,
      solved: isPlayer1 ? serverGameState.player1Solved : serverGameState.player2Solved,
      opponentSolved: isPlayer1 ? serverGameState.player2Solved : serverGameState.player1Solved,
      gameActive: !bothPlayersFinished && !matchCompleted, // Game active until both players finish OR match is completed
      targetWord: serverGameState.word, // Include target word for color calculation
      gameCompleted: bothPlayersFinished || matchCompleted // Indicate completion when both players done OR match marked complete
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting game state:', errorMessage);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Server-side payment execution endpoint
const executePaymentHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, paymentType } = req.body;
    
    if (!matchId || !wallet || !paymentType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate payment type
    if (!['payout', 'refund'].includes(paymentType)) {
      return res.status(400).json({ error: 'Invalid payment type' });
    }

    // Get match data
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Validate player is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Validate match is completed
    if (!match.isCompleted) {
      return res.status(400).json({ error: 'Match not completed' });
    }

    // Validate payout result exists
    if (!match.getPayoutResult()) {
      return res.status(400).json({ error: 'No payout result available' });
    }

    console.log('💰 Executing server-side payment:', {
      matchId,
      wallet,
      paymentType,
      payoutResult: match.getPayoutResult()
    });

    let paymentResult;
    
    // Direct payment approach - no server-side payment execution
    // Players handle their own payments through the frontend
    res.json({
      success: true,
      message: 'Direct payment approach - use frontend to send payments',
      paymentInstructions: match.getPayoutResult()?.paymentInstructions || null
    });

  } catch (error: unknown) {
    console.error('❌ Error executing payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create escrow transaction endpoint
const createEscrowTransactionHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, escrowAddress, entryFee } = req.body;
    
    console.log('🔒 Creating escrow transaction:', { matchId, wallet, escrowAddress, entryFee });
    
    if (!matchId || !wallet || !escrowAddress || !entryFee) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate the match exists and player is part of it
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    if (match.player1 !== wallet && match.player2 !== wallet) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }
    
    if (match.status !== 'escrow') {
      return res.status(400).json({ error: 'Match is not in escrow status' });
    }
    
    // Create the escrow transaction
    const { transferToEscrow } = require('../services/payoutService');
    const entryFeeLamports = Number(entryFee) * 1000000000; // Convert to lamports
    
    const escrowResult = await transferToEscrow(wallet, escrowAddress, entryFeeLamports);
    
    if (!escrowResult.success) {
      console.error('❌ Failed to create escrow transaction:', escrowResult.error);
      return res.status(500).json({ error: 'Failed to create escrow transaction' });
    }
    
    console.log('✅ Escrow transaction created successfully');
    
    res.json({
      success: true,
      transaction: escrowResult.transaction,
      message: 'Escrow transaction created - please sign and submit'
    });
    
  } catch (error: unknown) {
    console.error('❌ Error creating escrow transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const cleanupStuckMatchesHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.body;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    console.log('🧹 Cleaning up stuck matches for wallet:', wallet);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up stuck matches for this wallet (EXCEPT escrow status - those are active matches)
    const stuckMatches = await matchRepository.find({
      where: [
        { player1: wallet, status: 'waiting' },
        { player2: wallet, status: 'waiting' },
        { player1: wallet, status: 'active' },
        { player2: wallet, status: 'active' }
        // Removed escrow status - those are active matches that should not be cleaned up
      ]
    });
    
    if (stuckMatches.length > 0) {
      console.log(`🧹 Removing ${stuckMatches.length} stuck matches for wallet ${wallet}`);
      await matchRepository.remove(stuckMatches);
      
      return res.json({
        success: true,
        message: `Cleaned up ${stuckMatches.length} stuck matches`,
        cleanedMatches: stuckMatches.length
      });
    } else {
      return res.json({
        success: true,
        message: 'No stuck matches found',
        cleanedMatches: 0
      });
    }
  } catch (error: unknown) {
    console.error('❌ Error cleaning up stuck matches:', error);
    res.status(500).json({ error: 'Failed to cleanup matches' });
  }
};

// Simple cleanup endpoint for production
const simpleCleanupHandler = async (req: any, res: any) => {
  try {
    console.log('🧹 Running simple cleanup...');
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up old waiting matches (only stale ones)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const waitingMatches = await matchRepository.find({
      where: { 
        status: 'waiting',
        createdAt: LessThan(tenMinutesAgo)
      }
    });
    
    // Clean up old escrow matches (only stale ones)
    const escrowMatches = await matchRepository.find({
      where: { 
        status: 'escrow',
        createdAt: LessThan(tenMinutesAgo)
      }
    });
    
    let cleanedCount = 0;
    
    // NOTE: We do NOT clean up completed matches - they are kept for long-term storage and CSV downloads
    console.log(`📊 Found ${waitingMatches.length} stale waiting matches and ${escrowMatches.length} stale escrow matches to clean up`);
    
    if (waitingMatches.length > 0) {
      await matchRepository.remove(waitingMatches);
      cleanedCount += waitingMatches.length;
      console.log(`🧹 Cleaned up ${waitingMatches.length} waiting matches`);
    }
    
    if (escrowMatches.length > 0) {
      await matchRepository.remove(escrowMatches);
      cleanedCount += escrowMatches.length;
      console.log(`🧹 Cleaned up ${escrowMatches.length} escrow matches`);
    }
    
    // Clean up old payment_required matches and process refunds (only very old ones)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const paymentRequiredMatches = await matchRepository.find({
      where: { 
        status: 'payment_required',
        createdAt: LessThan(oneHourAgo) // Only remove very old payment_required matches
      }
    });
    
    if (paymentRequiredMatches.length > 0) {
      console.log(`🧹 Found ${paymentRequiredMatches.length} payment_required matches, processing refunds...`);
      
      // Process refunds for these matches before cleaning up
      for (const match of paymentRequiredMatches) {
        await processRefundsForFailedMatch(match);
      }
      
      await matchRepository.remove(paymentRequiredMatches);
      cleanedCount += paymentRequiredMatches.length;
      console.log(`🧹 Cleaned up ${paymentRequiredMatches.length} payment_required matches with refunds`);
    }
    
    // Clear in-memory games
    // Clear all Redis-based memory data
    console.log('🧹 Clearing all Redis memory data...');
    // Note: Individual cleanup is handled by the Redis memory manager
    // This is a placeholder for the old in-memory clear operations
    
          console.log(`🧹 Cleaned up ${cleanedCount} database matches`);
    
    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} database matches`,
      cleanedDatabase: cleanedCount,
      cleanedMemory: 0 // Redis-based memory is handled separately
    });
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Simple cleanup failed:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cleanup matches',
      details: errorMessage 
    });
  }
};

// New endpoint to force cleanup for a specific wallet (for testing)
const forceCleanupForWallet = async (req: any, res: any) => {
  try {
    const { wallet } = req.body;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    console.log(`🧹 Force cleanup requested for wallet: ${wallet}`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find all matches for this wallet
    const walletMatches = await matchRepository.find({
      where: [
        { player1: wallet },
        { player2: wallet }
      ]
    });
    
    if (walletMatches.length > 0) {
      console.log(`🧹 Found ${walletMatches.length} matches for ${wallet}, removing them`);
      await matchRepository.remove(walletMatches);
      console.log(`✅ Force cleaned up ${walletMatches.length} matches for ${wallet}`);
    }
    
    // Also cleanup stale waiting matches
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const staleWaitingMatches = await matchRepository.find({
      where: {
        status: 'waiting',
        createdAt: LessThan(fiveMinutesAgo)
      }
    });
    
    if (staleWaitingMatches.length > 0) {
      console.log(`🧹 Found ${staleWaitingMatches.length} stale waiting matches, removing them`);
      await matchRepository.remove(staleWaitingMatches);
      console.log(`✅ Cleaned up ${staleWaitingMatches.length} stale waiting matches`);
    }
    
    res.json({
      success: true,
      cleanedWalletMatches: walletMatches.length,
      cleanedStaleMatches: staleWaitingMatches.length,
      message: `Force cleaned up ${walletMatches.length} wallet matches and ${staleWaitingMatches.length} stale matches`
    });
  } catch (error: unknown) {
    console.error('❌ Error in force cleanup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to force cleanup matches'
    });
  }
};

// Process refunds for failed matches
const processRefundsForFailedMatch = async (match: any) => {
  try {
    console.log(`💰 Processing refunds for failed match ${match.id}`);
    
    const { getFeeWalletKeypair } = require('../config/wallet');
    const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    
    const feeWalletKeypair = getFeeWalletKeypair();
    if (!feeWalletKeypair) {
      console.error('❌ Fee wallet private key not available for refunds');
      return;
    }
    
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    
    // Ensure entryFee is available, fallback to 0.1 SOL if undefined
    const entryFee = match.entryFee || 0.1;
    const entryFeeLamports = Math.floor(entryFee * LAMPORTS_PER_SOL);
    
    // Calculate refund amount (entry fee minus network fee)
    const networkFeeLamports = Math.floor(0.0001 * LAMPORTS_PER_SOL); // 0.0001 SOL network fee
    const refundLamports = entryFeeLamports - networkFeeLamports;
    
    console.log(`💰 Refund calculation: ${entryFee} SOL - 0.0001 SOL = ${refundLamports / LAMPORTS_PER_SOL} SOL`);
    
    // Check fee wallet balance
    const feeWalletBalance = await connection.getBalance(feeWalletKeypair.publicKey);
    console.log(`💰 Fee wallet balance: ${feeWalletBalance / LAMPORTS_PER_SOL} SOL`);
    
    // Process refunds for players who paid
    if (match.player1Paid) {
      console.log(`💰 Processing refund for Player 1: ${match.player1} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      try {
        const refundTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: feeWalletKeypair.publicKey,
            toPubkey: new PublicKey(match.player1),
            lamports: refundLamports,
          })
        );
        
        const signature = await connection.sendTransaction(refundTx, [feeWalletKeypair]);
        await connection.confirmTransaction(signature);
        console.log(`✅ Refund sent to Player 1: ${signature} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
        console.error(`❌ Failed to refund Player 1: ${errorMessage}`);
      }
    }
    
    if (match.player2Paid) {
      console.log(`💰 Processing refund for Player 2: ${match.player2} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      try {
        const refundTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: feeWalletKeypair.publicKey,
            toPubkey: new PublicKey(match.player2),
            lamports: refundLamports,
          })
        );
        
        const signature = await connection.sendTransaction(refundTx, [feeWalletKeypair]);
        await connection.confirmTransaction(signature);
        console.log(`✅ Refund sent to Player 2: ${signature} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
        console.error(`❌ Failed to refund Player 2: ${errorMessage}`);
      }
    }
    
    console.log(`✅ All refunds processed for match ${match.id} (0.0001 SOL fee deducted per refund)`);
    
  } catch (error: unknown) {
    console.error('❌ Error processing refunds:', error);
  }
};

// Automated refund system - handles all refund scenarios
const processAutomatedRefunds = async (match: any, reason: any = 'unknown') => {
  try {
    console.log(`💰 Processing automated refunds for match ${match.id} - Reason: ${reason}`);
    
    // Only process refunds if players actually paid
    if (!match.player1Paid && !match.player2Paid) {
      console.log(`💰 No refunds needed - no players paid for match ${match.id}`);
      return;
    }
    
    // Process refunds
    await processRefundsForFailedMatch(match);
    
    // Mark match as cancelled/refunded
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    await matchRepository.update(match.id, {
      status: 'cancelled',
      refundReason: reason,
      refundedAt: new Date()
    });
    
    console.log(`✅ Automated refunds completed for match ${match.id}`);
    
  } catch (error: unknown) {
    console.error(`❌ Error in automated refunds for match ${match.id}:`, error);
  }
};

// Payment confirmation endpoint
const confirmPaymentHandler = async (req: any, res: any) => {
  try {
    console.log('📥 Received confirm payment request:', {
      body: req.body,
      headers: req.headers,
      method: req.method,
      url: req.url
    });

    const { matchId, wallet, paymentSignature, smartContractData } = req.body;
    
    console.log('🔍 Parsed confirm payment data:', { 
      matchId, 
      wallet, 
      paymentSignature, 
      smartContractData: smartContractData ? 'Present' : 'Not present' 
    });
    
    if (!matchId || !wallet || !paymentSignature) {
      console.log('❌ Missing required fields:', { matchId: !!matchId, wallet: !!wallet, paymentSignature: !!paymentSignature });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Get database repository
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find the match
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    // Debug: Log current payment status before processing
    console.log(`🔍 Payment status BEFORE processing for match ${matchId}:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2,
      currentPlayer: wallet
    });

    // Validate player is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerKey = isPlayer1 ? 'player1' : 'player2';

    // Check if already paid - but allow retries for better reliability
    if (isPlayer1 && match.player1Paid) {
      console.log(`⚠️ Player 1 already marked as paid for match ${matchId}`);
      // Return success instead of error to prevent frontend issues
      return res.json({
        success: true,
        status: match.status,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        message: 'Payment already confirmed'
      });
    }
    if (!isPlayer1 && match.player2Paid) {
      console.log(`⚠️ Player 2 already marked as paid for match ${matchId}`);
      // Return success instead of error to prevent frontend issues
      return res.json({
        success: true,
        status: match.status,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        message: 'Payment already confirmed'
      });
    }

    // Enhanced transaction verification - use smart contract verification if available
    let verificationResult;
    
    console.log('🔍 Smart contract data received:', {
      hasSmartContractData: !!smartContractData,
      smartContractVerified: smartContractData?.smartContractVerified,
      matchPda: smartContractData?.matchPda,
      vaultPda: smartContractData?.vaultPda,
      verificationDetails: smartContractData?.verificationDetails
    });
    
    if (smartContractData && smartContractData.smartContractVerified) {
      // For smart contract payments, use the verification details from frontend
      console.log('🔗 Using smart contract payment verification');
      verificationResult = {
        verified: true,
        amount: match.entryFee,
        timestamp: smartContractData.verificationDetails?.blockTime,
        slot: smartContractData.verificationDetails?.slot,
        signature: paymentSignature,
        details: smartContractData.verificationDetails
      };
    } else {
      // For legacy payments, use the fee wallet verification service
      console.log('💰 Using legacy fee wallet payment verification');
      console.log('⚠️ Smart contract data missing or not verified, falling back to legacy verification');
      verificationResult = await paymentVerificationService.verifyPayment(
        paymentSignature, 
        wallet, 
        match.entryFee,
        {
          tolerance: 0.001,
          requireConfirmation: true,
          maxRetries: 3,
          timeout: 30000
        }
      );
    }

    if (!verificationResult.verified) {
      console.error('❌ Payment verification failed:', verificationResult.error);
      return res.status(400).json({ 
        error: 'Payment verification failed',
        details: verificationResult.error
      });
    }

    console.log(`✅ Payment verified for ${isPlayer1 ? 'Player 1' : 'Player 2'}:`, {
      matchId,
      wallet,
      paymentSignature,
      amount: verificationResult.amount,
      timestamp: verificationResult.timestamp,
      slot: verificationResult.slot
    });

    // Mark player as paid (preserve existing payment status)
    if (isPlayer1) {
      match.player1Paid = true;
      if (paymentSignature) {
        match.player1PaymentSignature = paymentSignature;
      }
    } else {
      match.player2Paid = true;
      if (paymentSignature) {
        match.player2PaymentSignature = paymentSignature;
      }
    }
    
    // Update smart contract fields if present
    if (smartContractData) {
      if (smartContractData.matchPda) {
        match.matchPda = smartContractData.matchPda;
      }
      if (smartContractData.vaultPda) {
        match.vaultPda = smartContractData.vaultPda;
      }
      if (smartContractData.smartContractVerified !== undefined) {
        match.smartContractStatus = smartContractData.smartContractVerified ? 'verified' : 'unverified';
      }
    }
    
    // IMMEDIATELY save payment status to database so other player can see it
    await matchRepository.save(match);
    
    console.log(`✅ Marked ${isPlayer1 ? 'Player 1' : 'Player 2'} (${wallet}) as paid for match ${matchId}`);
    
    // Ensure we preserve both players' payment status
    console.log(`🔍 Current payment status after marking ${isPlayer1 ? 'Player 1' : 'Player 2'} as paid:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2
    });

    // Payment tracking updated
    console.log(`✅ Payment tracking updated for ${isPlayer1 ? 'Player 1' : 'Player 2'}`);

    // Send WebSocket event for payment received
    websocketService.broadcastToMatch(matchId, {
      type: WebSocketEventType.PAYMENT_RECEIVED,
      matchId,
      data: {
        player: isPlayer1 ? 'player1' : 'player2',
        wallet,
        amount: verificationResult.amount,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid
      },
      timestamp: new Date().toISOString()
    });

    console.log(`🔍 Payment status for match ${matchId}:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2,
      currentPlayer: wallet
    });

    // Get fresh match data from database to ensure we have latest payment status
    const freshMatch = await matchRepository.findOne({ where: { id: matchId } });
    if (!freshMatch) {
      return res.status(404).json({ error: 'Match not found after payment' });
    }
    
    console.log(`🔍 Fresh match data after payment for match ${matchId}:`, {
      player1Paid: freshMatch.player1Paid,
      player2Paid: freshMatch.player2Paid,
      player1: freshMatch.player1,
      player2: freshMatch.player2,
      status: freshMatch.status,
      currentPlayer: wallet
    });
    
    // Check if both players have paid
    if (freshMatch.player1Paid && freshMatch.player2Paid) {
      console.log(`🎮 Both players have paid for match ${matchId}, starting game IMMEDIATELY...`);
      console.log(`💰 Payment details:`, {
        matchId,
        player1: freshMatch.player1,
        player2: freshMatch.player2,
        player1Paid: freshMatch.player1Paid,
        player2Paid: freshMatch.player2Paid,
        entryFee: freshMatch.entryFee
      });
      
      // Use state machine to transition to active
      const transitionSuccess = await matchStateMachine.transition(freshMatch, 'active' as any, {
        action: 'payment_complete',
        wallet,
        verificationResult
      });

      if (!transitionSuccess) {
        console.error('❌ State transition failed for match:', matchId);
        return res.status(500).json({ error: 'Failed to activate game' });
      }
      
      // Initialize server-side game state with the SAME word for both players
      const word = freshMatch.word || getRandomWord();
      
      // Ensure the word is saved to the database for both players to access
      freshMatch.word = word;
      
      const newGameState = {
        startTime: Date.now(),
        player1StartTime: Date.now(),
        player2StartTime: Date.now(),
        player1Guesses: [],
        player2Guesses: [],
        player1Solved: false,
        player2Solved: false,
        word: word, // SAME word for both players to compete
        matchId: matchId,
        lastActivity: Date.now(),
        completed: false
      };
      await setGameState(matchId, newGameState);

          console.log(`🎮 Game started for match ${matchId}`);
    // Get active games count from Redis
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    console.log(`🎮 Active games count: ${stats.activeGames}`);
      console.log(`🎮 Game state initialized:`, {
        matchId,
        word,
        player1: freshMatch.player1,
        player2: freshMatch.player2,
        startTime: Date.now()
      });
      
      // IMMEDIATELY save to database so both players can see the status change
      await matchRepository.save(freshMatch);
      console.log(`✅ Match ${matchId} status saved as 'active' - both players will be redirected`);
      
      // Send WebSocket event for game started
      websocketService.broadcastToMatch(matchId, {
        type: WebSocketEventType.GAME_STARTED,
        matchId,
        data: {
          player1: freshMatch.player1,
          player2: freshMatch.player2,
          entryFee: freshMatch.entryFee,
          startTime: match.gameStartTime
        },
        timestamp: new Date().toISOString()
      });
      
      // Return the updated status immediately
      return res.json({
        success: true,
        status: 'active',
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        message: 'Game started!'
      });
    } else {
      console.log(`⏳ Waiting for other player to pay for match ${matchId}. Player1Paid: ${match.player1Paid}, Player2Paid: ${match.player2Paid}`);
      
      // Set a timeout for payment completion (1 minute)
      const paymentTimeout = setTimeout(async () => {
        try {
          console.log(`⏰ Payment timeout check for match ${matchId}`);
          const { AppDataSource } = require('../db/index');
          const timeoutMatchRepository = AppDataSource.getRepository(Match);
          const timeoutMatch = await timeoutMatchRepository.findOne({ where: { id: matchId } });
          
          if (timeoutMatch && timeoutMatch.status === 'payment_required' && (!timeoutMatch.player1Paid || !timeoutMatch.player2Paid)) {
            console.log(`⏰ Payment timeout for match ${matchId} - cancelling match and processing refunds`);
            
            // Process refunds for any players who paid
            await processRefundsForFailedMatch(timeoutMatch);
            
            // Mark match as cancelled
            timeoutMatch.status = 'cancelled';
            timeoutMatch.player1Paid = false;
            timeoutMatch.player2Paid = false;
            await timeoutMatchRepository.save(timeoutMatch);
            
            // Clean up any in-memory references
            await deleteGameState(matchId);
            await deleteMatchmakingLock(matchId);
            
            console.log(`✅ Match ${matchId} cancelled due to payment timeout`);
          }
        } catch (error: unknown) {
          console.error('❌ Error handling payment timeout:', error);
        }
      }, 60000); // 1 minute timeout
      
      // Store the timeout reference in Redis (since database might not have this field)
      if (!match.timeoutId) {
        match.timeoutId = paymentTimeout;
      }
      
      // Also store in Redis for cleanup
      if (!(await getMatchmakingLock(matchId)) !== null) {
        await setMatchmakingLock(matchId, {
          promise: Promise.resolve(),
          timestamp: Date.now(),
          wallet: wallet,
          entryFee: match.entryFee
        });
      }
    }

    console.log(`💾 Saving match ${matchId} to database:`, {
      status: match.status,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid
    });
    
    await matchRepository.save(match);
    
    console.log(`✅ Match ${matchId} saved successfully`);

    res.json({
      success: true,
      status: match.status,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      message: match.status === 'active' ? 'Game started!' : 'Waiting for other player to pay'
    });

  } catch (error: unknown) {
    console.error('❌ Error confirming payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Import Phase 2 services
const { websocketService } = require('../services/websocketService');
const { matchStateMachine } = require('../services/stateMachine');
const { paymentVerificationService } = require('../services/paymentVerificationService');
const { WebSocketEventType } = require('../services/websocketService');
const { enhancedLogger } = require('../utils/enhancedLogger');

// WebSocket stats endpoint
const websocketStatsHandler = async (req: any, res: any) => {
  try {
    const stats = websocketService.getStats();
    res.json({
      timestamp: new Date().toISOString(),
      websocket: stats,
      services: {
        stateMachine: matchStateMachine.getStats(),
        paymentVerification: paymentVerificationService.getStats()
      }
    });
  } catch (error: unknown) {
    enhancedLogger.error('❌ WebSocket stats failed:', error);
    res.status(500).json({ error: 'Failed to get WebSocket stats' });
  }
};

// Enhanced payment verification function with idempotency
const verifyPaymentTransaction = async (signature: string, fromWallet: string, expectedAmount: number) => {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    
    console.log('🔍 ENHANCED: Verifying payment transaction:', {
      signature,
      fromWallet,
      expectedAmount,
      network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com'
    });
    
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!transaction) {
      return {
        verified: false,
        error: 'Transaction not found on blockchain'
      };
    }
    
    if (transaction.meta?.err) {
      return {
        verified: false,
        error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
      };
    }
    
    // Verify the transaction is a transfer to the fee wallet
    const feeWalletPublicKey = new PublicKey(process.env.FEE_WALLET_ADDRESS);
    const fromWalletPublicKey = new PublicKey(fromWallet);
    
    const preBalances = transaction.meta?.preBalances || [];
    const postBalances = transaction.meta?.postBalances || [];
    const accountKeys = transaction.transaction.message.accountKeys;
    
    // Find the fee wallet account index
    const feeWalletIndex = accountKeys.findIndex((key: any) => key.equals(feeWalletPublicKey));
    const fromWalletIndex = accountKeys.findIndex((key: any) => key.equals(fromWalletPublicKey));
    
    if (feeWalletIndex === -1 || fromWalletIndex === -1) {
      return {
        verified: false,
        error: 'Invalid transaction - fee wallet or from wallet not found in transaction'
      };
    }
    
    // Check if the fee wallet received the payment
    const feeWalletPreBalance = preBalances[feeWalletIndex] || 0;
    const feeWalletPostBalance = postBalances[feeWalletIndex] || 0;
    const feeWalletGain = feeWalletPostBalance - feeWalletPreBalance;
    
    const fromWalletPreBalance = preBalances[fromWalletIndex] || 0;
    const fromWalletPostBalance = postBalances[fromWalletIndex] || 0;
    const fromWalletLoss = fromWalletPreBalance - fromWalletPostBalance;
    
    console.log('🔍 ENHANCED: Payment verification details:', {
      feeWalletGain: feeWalletGain / 1000000000,
      fromWalletLoss: fromWalletLoss / 1000000000,
      expectedAmount: expectedAmount,
      signature: signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime
    });
    
    // Verify the payment amount (with small tolerance for transaction fees)
    const tolerance = 0.001; // 0.001 SOL tolerance
    const expectedAmountLamports = expectedAmount * 1000000000;
    const minExpectedGain = expectedAmountLamports - (tolerance * 1000000000);
    
    if (feeWalletGain < minExpectedGain) {
      return {
        verified: false,
        error: 'Payment amount insufficient',
        details: {
          received: feeWalletGain / 1000000000,
          expected: expectedAmount,
          tolerance: tolerance
        }
      };
    }
    
    return {
      verified: true,
      amount: feeWalletGain / 1000000000,
      timestamp: transaction.blockTime,
      slot: transaction.slot,
      signature: signature,
      details: {
        feeWalletGain: feeWalletGain / 1000000000,
        fromWalletLoss: fromWalletLoss / 1000000000,
        transactionFee: transaction.meta?.fee ? transaction.meta.fee / 1000000000 : 0
      }
    };
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ ENHANCED: Payment verification error:', error);
    return {
      verified: false,
      error: `Verification failed: ${errorMessage}`
    };
  }
};

// Debug matches endpoint
const debugMatchesHandler = async (req: any, res: any) => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get all matches
    const allMatches = await matchRepository.find({
      order: { createdAt: 'DESC' },
      take: 20
    });
    
    // Get active games from Redis (placeholder - Redis doesn't have entries() method)
    const activeGamesList: any[] = []; // TODO: Implement Redis-based active games list
    
    res.json({
      timestamp: new Date().toISOString(),
      totalMatches: allMatches.length,
      activeGames: activeGamesList,
      matches: allMatches.map((match: any) => ({
        id: match.id,
        status: match.status,
        player1: match.player1,
        player2: match.player2,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        entryFee: match.entryFee,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt
      }))
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in debug matches:', error);
    res.status(500).json({ error: 'Debug failed' });
  }
};

// Memory monitoring endpoint
const memoryStatsHandler = async (req: any, res: any) => {
  try {
    const { AppDataSource } = require('../db/index');
    
    // Get database stats
    const matchRepository = AppDataSource.getRepository(Match);
    const totalMatches = await matchRepository.count();
    const waitingMatches = await matchRepository.count({ where: { status: 'waiting' } });
    const activeMatches = await matchRepository.count({ where: { status: 'active' } });
    const completedMatches = await matchRepository.count({ where: { status: 'completed' } });
    
    // Get memory stats from Redis
    const memoryStats = await redisMemoryManager.getInstance().checkMemoryLimits();
    
    res.json({
      timestamp: new Date().toISOString(),
      memory: memoryStats,
      database: {
        totalMatches,
        waitingMatches,
        activeMatches,
        completedMatches
      },
      warnings: memoryStats.warnings
    });
    
  } catch (error: unknown) {
    console.error('❌ Memory stats failed:', error);
    res.status(500).json({ error: 'Failed to get memory stats' });
  }
};

// Debug endpoint to check matchmaking state
const debugMatchmakingHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet parameter required' });
    }
    
    console.log('🔍 Debug matchmaking for wallet:', wallet);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get all matches for this wallet
    const allMatches = await matchRepository.find({
      where: [
        { player1: wallet },
        { player2: wallet }
      ],
      order: { createdAt: 'DESC' }
    });
    
    // Get waiting matches
    const waitingMatches = await matchRepository.find({
      where: { status: 'waiting' },
      order: { createdAt: 'ASC' }
    });
    
    // Check matchmaking locks
    const lockKey = `matchmaking_${wallet}`;
    const hasLock = (await getMatchmakingLock(lockKey)) !== null;
    const lockData = hasLock ? await getMatchmakingLock(lockKey) : null;
    
    res.json({
      wallet,
      timestamp: new Date().toISOString(),
      allMatches: allMatches.map((m: any) => ({
        id: m.id,
        status: m.status,
        player1: m.player1,
        player2: m.player2,
        entryFee: m.entryFee,
        createdAt: m.createdAt,
        player1Paid: m.player1Paid,
        player2Paid: m.player2Paid
      })),
      waitingMatches: waitingMatches.map((m: any) => ({
        id: m.id,
        player1: m.player1,
        entryFee: m.entryFee,
        createdAt: m.createdAt
      })),
      matchmakingLock: {
        hasLock,
        lockData: hasLock && lockData ? {
          timestamp: lockData.timestamp,
          wallet: lockData.wallet,
          entryFee: lockData.entryFee,
          age: Date.now() - lockData.timestamp
        } : null
      },
      memoryStats: await redisMemoryManager.getInstance().checkMemoryLimits()
    });
    
  } catch (error: unknown) {
    console.error('❌ Debug matchmaking failed:', error);
    res.status(500).json({ error: 'Failed to get debug info' });
  }
};

// Manual refund endpoint for testing
const manualRefundHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.body;
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID required' });
    }
    
    console.log(`💰 Manual refund requested for match: ${matchId}`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    console.log(`💰 Processing manual refund for match ${matchId}:`, {
      player1: match.player1,
      player2: match.player2,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      status: match.status
    });
    
    // Process refunds
    await processRefundsForFailedMatch(match);
    
    // Mark match as cancelled
    match.status = 'cancelled';
    await matchRepository.save(match);
    
    res.json({
      success: true,
      message: 'Manual refund processed successfully',
      matchId: matchId
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in manual refund:', error);
    res.status(500).json({ error: 'Failed to process manual refund' });
  }
};

// Manual match endpoint to fix stuck matchmaking
const manualMatchHandler = async (req: any, res: any) => {
  try {
    const { player1, player2, entryFee } = req.body;
    
    if (!player1 || !player2 || !entryFee) {
      return res.status(400).json({ error: 'player1, player2, and entryFee required' });
    }
    
    console.log(`🎮 Manual match requested: ${player1} vs ${player2} with ${entryFee} SOL`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up any existing waiting matches for these players
    const existingMatches = await matchRepository.find({
      where: [
        { player1: player1, status: 'waiting' },
        { player2: player1, status: 'waiting' },
        { player1: player2, status: 'waiting' },
        { player2: player2, status: 'waiting' }
      ]
    });
    
    if (existingMatches.length > 0) {
      console.log(`🧹 Cleaning up ${existingMatches.length} existing waiting matches`);
      await matchRepository.remove(existingMatches);
    }
    
    // Create a new match
    const newMatch = matchRepository.create({
      player1: player1,
      player2: player2,
      entryFee: entryFee,
    status: 'payment_required',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await matchRepository.save(newMatch);
    
    console.log(`✅ Manual match created: ${newMatch.id}`);
    
    res.json({
      success: true,
      message: 'Manual match created successfully',
      matchId: newMatch.id,
      player1: player1,
      player2: player2,
      entryFee: entryFee,
    status: 'vault_pending',
    squadsVaultAddress: null,
    vaultAddress: null
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in manual match:', error);
    res.status(500).json({ error: 'Failed to create manual match' });
  }
};

// Database migration endpoint (for adding new columns)
const runMigrationHandler = async (req: any, res: any) => {
  try {
    console.log('🔄 Running database migration...');
    
    const { AppDataSource } = require('../db/index');
    
    // Run the migration SQL directly
    const migrationQueries = [

      // Payment signature columns
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1PaymentSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2PaymentSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "winnerPayoutSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1RefundSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2RefundSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "matchOutcome" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "gameEndTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "matchDuration" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalFeesCollected" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "platformFee" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundReason" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1Moves" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2Moves" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1CompletionTime" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2CompletionTime" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "targetWord" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1Guesses" JSONB`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2Guesses" JSONB`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1PaymentTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2PaymentTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1LastGuessTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2LastGuessTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundAmount" DECIMAL(10,6)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "payoutAmount" DECIMAL(10,6)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "disputeFlagged" BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "disputeNotes" TEXT`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "resolvedBy" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "resolutionTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalRevenue" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalPayouts" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalRefunds" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netRevenue" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "platformRevenue" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "networkFees" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "taxableIncome" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "fiscalYear" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "quarter" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "entryFeeUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundAmountUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "payoutAmountUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "platformFeeUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalFeesCollectedUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "solPriceAtTransaction" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "transactionTimestamp" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "actualNetworkFees" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "actualNetworkFeesUSD" DECIMAL(10,2) DEFAULT 0`
    ];
    
    for (const query of migrationQueries) {
      try {
        await AppDataSource.query(query);
        console.log(`✅ Executed: ${query}`);
      } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
        console.log(`⚠️ Column might already exist: ${errorMessage}`);
      }
    }
    
    console.log('✅ Database migration completed successfully');
    
    res.json({
      success: true,
      message: 'Database migration completed successfully',
      columnsAdded: [

        // Payment signature columns
        'player1PaymentSignature',
        'player2PaymentSignature', 
        'winnerPayoutSignature',
        'player1RefundSignature',
        'player2RefundSignature',
        'matchOutcome',
        'gameEndTime',
        'matchDuration',
        'totalFeesCollected',
        'platformFee',
        'refundReason',
        'refundedAt',
        'player1Moves',
        'player2Moves',
        'player1CompletionTime',
        'player2CompletionTime',
        'targetWord',
        'player1Guesses',
        'player2Guesses',
        'player1PaymentTime',
        'player2PaymentTime',
        'player1LastGuessTime',
        'player2LastGuessTime',
        'refundAmount',
        'payoutAmount',
        'disputeFlagged',
        'disputeNotes',
        'resolvedBy',
        'resolutionTime',
        'totalRevenue',
        'totalPayouts',
        'totalRefunds',
        'netRevenue',
        'platformRevenue',
        'networkFees',
        'taxableIncome',
        'fiscalYear',
        'quarter',
        'entryFeeUSD',
        'refundAmountUSD',
        'payoutAmountUSD',
        'platformFeeUSD',
        'totalFeesCollectedUSD',
        'solPriceAtTransaction',
        'transactionTimestamp',
        'actualNetworkFees',
        'actualNetworkFeesUSD'
      ]
    });
    
  } catch (error: unknown) {
    console.error('❌ Error running migration:', error);
    res.status(500).json({ error: 'Failed to run migration' });
  }
};

// Helper function to convert UTC to EST
const convertToEST = (date: any) => {
  if (!date) return '';
  const utcDate = new Date(date);
  const estDate = new Date(utcDate.toLocaleString("en-US", {timeZone: "America/New_York"}));
  return estDate.toISOString().replace('T', ' ').substring(0, 19);
};

// Cache for SOL price to reduce API calls
let solPriceCache = {
  price: null as number | null,
  timestamp: 0,
  expiresAt: 0
};

// Helper function to get SOL price in USD with robust fallback system
const getSolPriceUSD = async () => {
  const CACHE_DURATION_MS = 30000; // Cache for 30 seconds
  const now = Date.now();
  
  // Check cache first
  if (solPriceCache.price && solPriceCache.expiresAt > now) {
    return solPriceCache.price;
  }
  
  // Clear expired cache
  if (solPriceCache.expiresAt <= now) {
    solPriceCache = { price: null, timestamp: 0, expiresAt: 0 };
  }
  const TIMEOUT_MS = 5000; // 5 second timeout
  const MAX_RETRIES = 2;
  
  // Helper function to make a fetch request with timeout
  const fetchWithTimeout = async (url: string, options: any = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Guess5-Game/1.0',
          'Accept': 'application/json',
          ...options.headers
        }
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

    // Try CoinGecko API with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      
      if (!response.ok) {
        throw new Error(`CoinGecko API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.solana && data.solana.usd && typeof data.solana.usd === 'number' && data.solana.usd > 0) {
        const price = data.solana.usd;
        // Cache the successful result
        solPriceCache = {
          price,
          timestamp: now,
          expiresAt: now + CACHE_DURATION_MS
        };
        return price;
      }
      throw new Error('Invalid SOL price data from CoinGecko');
    } catch (error: unknown) {
      if (attempt === MAX_RETRIES) {
        console.error('❌ SOL price fetch failed from all sources');
      } else {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
    // Fallback: Try Binance API with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
      
      if (!response.ok) {
        throw new Error(`Binance API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.price && typeof data.price === 'string' && parseFloat(data.price) > 0) {
        const price = parseFloat(data.price);
        // Cache the successful result
        solPriceCache = {
          price,
          timestamp: now,
          expiresAt: now + CACHE_DURATION_MS
        };
        return price;
      }
      throw new Error('Invalid SOL price data from Binance');
    } catch (error: unknown) {
      if (attempt === MAX_RETRIES) {
        console.error('❌ SOL price fetch failed from all sources');
      } else {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
    // Final fallback: Use recent match data to calculate SOL price
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get the most recent completed match with valid SOL price data
    const recentMatch = await matchRepository.findOne({
      where: {
        status: 'completed',
        solPriceAtTransaction: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatch && recentMatch.solPriceAtTransaction && recentMatch.solPriceAtTransaction > 0) {
      const price = recentMatch.solPriceAtTransaction;
      // Cache the fallback result
      solPriceCache = {
        price,
        timestamp: now,
        expiresAt: now + CACHE_DURATION_MS
      };
      return price;
    }
    
    // If no recent match with price, try to calculate from entry fee and USD amount
    const recentMatchWithUSD = await matchRepository.findOne({
      where: {
        status: 'completed',
        entryFeeUSD: Not(IsNull()),
        entryFee: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatchWithUSD && recentMatchWithUSD.entryFeeUSD && recentMatchWithUSD.entryFee && recentMatchWithUSD.entryFee > 0) {
      const calculatedPrice = recentMatchWithUSD.entryFeeUSD / recentMatchWithUSD.entryFee;
      if (calculatedPrice > 0) {
        // Cache the calculated fallback result
        solPriceCache = {
          price: calculatedPrice,
          timestamp: now,
          expiresAt: now + CACHE_DURATION_MS
        };
        return calculatedPrice;
      }
    }
    
    return null;
  } catch (dbError) {
    console.error('❌ Error getting fallback price from database:', dbError);
    return null;
  }
};

// Helper function to determine the correct network for explorer links
const getExplorerNetwork = () => {
  const network = (process.env.SOLANA_NETWORK && process.env.SOLANA_NETWORK.toLowerCase().includes('devnet')) ? 'devnet' : 'mainnet';
  console.log(`🔗 Network detection: SOLANA_NETWORK="${process.env.SOLANA_NETWORK}", detected="${network}"`);
  return network;
};

// Helper function to get the most recent SOL price from completed matches
const getRecentSolPriceFromMatches = async () => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get the most recent completed match with valid SOL price data
    const recentMatch = await matchRepository.findOne({
      where: {
        status: 'completed',
        solPriceAtTransaction: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatch && recentMatch.solPriceAtTransaction) {
      return recentMatch.solPriceAtTransaction;
    }
    
    // If no recent match with price, try to calculate from entry fee and USD amount
    const recentMatchWithUSD = await matchRepository.findOne({
      where: {
        status: 'completed',
        entryFeeUSD: Not(IsNull()),
        entryFee: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatchWithUSD && recentMatchWithUSD.entryFeeUSD && recentMatchWithUSD.entryFee) {
      return recentMatchWithUSD.entryFeeUSD / recentMatchWithUSD.entryFee;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error getting recent SOL price from matches:', error);
    return null;
  }
};

// Helper function to get transaction details from blockchain
const getTransactionDetails = async (signature: any) => {
  try {
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!transaction) {
      console.log(`⚠️ Transaction not found: ${signature}`);
      return null;
    }
    
    // Get actual transaction fee (what Phantom charged)
    const actualFee = transaction.meta?.fee || 0;
    const feeInSOL = actualFee / LAMPORTS_PER_SOL;
    
    // Get transaction timestamp
    const blockTime = transaction.blockTime;
    const transactionDate = blockTime ? new Date(blockTime * 1000) : new Date();
    
    // Get SOL price at transaction time
    const solPrice = await getSolPriceUSD();
    
    // Create explorer links
    const network = getExplorerNetwork();
    const explorerLink = `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
    const solscanLink = `https://solscan.io/tx/${signature}?cluster=${network}`;
    
    return {
      signature,
      actualFee: feeInSOL,
      actualFeeUSD: solPrice ? feeInSOL * solPrice : null,
      transactionDate,
      solPriceAtTime: solPrice,
      confirmed: transaction.meta?.err === null,
      slot: transaction.slot,
      blockTime: blockTime,
      explorerLink,
      solscanLink
    };
  } catch (error: unknown) {
    console.error(`❌ Error fetching transaction ${signature}:`, error);
    return null;
  }
};

// Helper function to verify and update match with blockchain data
const updateMatchWithBlockchainData = async (match: any) => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    let totalNetworkFees = 0;
    let totalNetworkFeesUSD = 0;
    let totalActualFees = 0;
    let totalActualFeesUSD = 0;
    
    // Verify player1 payment
    if (match.player1PaymentSignature) {
      const txDetails = await getTransactionDetails(match.player1PaymentSignature);
      if (txDetails) {
        match.player1PaymentTime = txDetails.transactionDate;
        match.player1PaymentBlockTime = txDetails.transactionDate;
        match.player1PaymentBlockNumber = txDetails.slot;
        match.player1PaymentConfirmed = txDetails.confirmed;
        match.player1PaymentFee = txDetails.actualFee;
        match.solPriceAtTransaction = txDetails.solPriceAtTime;
        match.entryFeeUSD = match.entryFee * (txDetails.solPriceAtTime || 0);
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player1 payment: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Verify player2 payment
    if (match.player2PaymentSignature) {
      const txDetails = await getTransactionDetails(match.player2PaymentSignature);
      if (txDetails) {
        match.player2PaymentTime = txDetails.transactionDate;
        match.player2PaymentBlockTime = txDetails.transactionDate;
        match.player2PaymentBlockNumber = txDetails.slot;
        match.player2PaymentConfirmed = txDetails.confirmed;
        match.player2PaymentFee = txDetails.actualFee;
        if (!match.solPriceAtTransaction) {
          match.solPriceAtTransaction = txDetails.solPriceAtTime;
          match.entryFeeUSD = match.entryFee * (txDetails.solPriceAtTime || 0);
        }
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player2 payment: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Verify winner payout
    if (match.winnerPayoutSignature) {
      const txDetails = await getTransactionDetails(match.winnerPayoutSignature);
      if (txDetails) {
        match.payoutAmount = match.entryFee * 2 * 0.95; // 95% of total entry fees
        match.payoutAmountUSD = match.payoutAmount * (txDetails.solPriceAtTime || 0);
        match.winnerPayoutBlockTime = txDetails.transactionDate;
        match.winnerPayoutBlockNumber = txDetails.slot;
        match.winnerPayoutConfirmed = txDetails.confirmed;
        match.winnerPayoutFee = txDetails.actualFee;
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified winner payout: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Verify refunds
    if (match.player1RefundSignature) {
      const txDetails = await getTransactionDetails(match.player1RefundSignature);
      if (txDetails) {
        match.refundAmount = match.entryFee - 0.0001; // Entry fee minus network fee
        match.refundAmountUSD = match.refundAmount * (txDetails.solPriceAtTime || 0);
        match.player1RefundBlockTime = txDetails.transactionDate;
        match.player1RefundBlockNumber = txDetails.slot;
        match.player1RefundConfirmed = txDetails.confirmed;
        match.player1RefundFee = txDetails.actualFee;
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player1 refund: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    if (match.player2RefundSignature) {
      const txDetails = await getTransactionDetails(match.player2RefundSignature);
      if (txDetails) {
        if (!match.refundAmount) {
          match.refundAmount = match.entryFee - 0.0001;
          match.refundAmountUSD = match.refundAmount * (txDetails.solPriceAtTime || 0);
        }
        match.player2RefundBlockTime = txDetails.transactionDate;
        match.player2RefundBlockNumber = txDetails.slot;
        match.player2RefundConfirmed = txDetails.confirmed;
        match.player2RefundFee = txDetails.actualFee;
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player2 refund: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Calculate financial totals
    match.totalFeesCollected = match.entryFee * 2;
    match.totalFeesCollectedUSD = match.totalFeesCollected * (match.solPriceAtTransaction || 0);
    match.platformFee = match.totalFeesCollected * 0.05; // 5% platform fee
    match.platformFeeUSD = match.platformFee * (match.solPriceAtTransaction || 0);
    match.actualNetworkFees = totalActualFees; // Actual blockchain fees from Phantom
    match.actualNetworkFeesUSD = totalActualFeesUSD; // Actual fees in USD
    match.networkFees = totalActualFees; // For backward compatibility
    match.totalRevenue = match.totalFeesCollected;
    match.totalPayouts = match.payoutAmount || 0;
    match.totalRefunds = (match.player1RefundSignature ? match.refundAmount : 0) + 
                        (match.player2RefundSignature ? match.refundAmount : 0);
    match.netRevenue = match.totalRevenue - match.totalPayouts - match.totalRefunds;
    match.platformRevenue = match.platformFee;
    match.taxableIncome = match.platformRevenue - match.actualNetworkFees; // Use actual network fees
    
    // Set fiscal info
    const fiscalInfo = getFiscalInfo(match.createdAt);
    match.fiscalYear = fiscalInfo.fiscalYear;
    match.quarter = fiscalInfo.quarter;
    
    // Save updated match
    await matchRepository.save(match);
    
    console.log(`💰 Updated match ${match.id} with blockchain data:`);
    console.log(`   Total actual fees: ${totalActualFees} SOL (${totalActualFeesUSD} USD)`);
    console.log(`   Taxable income: ${match.taxableIncome} SOL`);
    
    return match;
    
  } catch (error: unknown) {
    console.error('❌ Error updating match with blockchain data:', error);
    return null;
  }
};

// Helper function to calculate fiscal year and quarter
const getFiscalInfo = (date: any) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { fiscalYear: year, quarter };
};

// Match report endpoint (exports to CSV) - Updated with high-impact security fixes
const generateReportHandler = async (req: any, res: any) => {
  try {
    const { startDate = '2025-08-16', endDate, includeWords = 'false' } = req.query;
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Build date filter
    let dateFilter = `DATE("createdAt") >= '${startDate}'`;
    if (endDate) {
      dateFilter += ` AND DATE("createdAt") <= '${endDate}'`;
    }
    
    // Get all FINISHED matches with Squads data (completed games, cancelled games with refunds)
    const matches = await matchRepository.query(`
      SELECT 
        id,
        "player1",
        "player2",
        "entryFee",
        status,
        CASE 
          WHEN "isCompleted" = true THEN word 
          ELSE '***PROTECTED***' 
        END as word,
        "squadsVaultAddress",
        "depositATx",
        "depositBTx",
        "depositAConfirmations",
        "depositBConfirmations",
        "gameStartTime",
        "gameStartTimeUtc",
        "gameEndTime",
        "gameEndTimeUtc",
        "player1Paid",
        "player2Paid",
        "player1Result",
        "player2Result",
        winner,
        "payoutResult",
        "proposalTransactionId",
        "proposalTransactionId" as "refundTxHash",
        "player1RefundSignature",
        "player2RefundSignature",
        "matchOutcome",
        "totalFeesCollected",
        "platformFee",
        "matchDuration",
        "refundReason",
        "refundedAt",
        "refundedAtUtc",
        "isCompleted",
        "createdAt",
        "updatedAt",
        "payoutProposalId",
        "proposalStatus",
        "proposalCreatedAt",
        "needsSignatures",
        "proposalSigners",
        "proposalExecutedAt"
      FROM "match" 
      WHERE ${dateFilter}
        AND "squadsVaultAddress" IS NOT NULL
        AND (
          -- Include all completed matches (winners, losers, ties, losing ties)
          (status = 'completed' AND "isCompleted" = true)
          OR 
          -- Include cancelled matches that have refund signatures
          (status = 'cancelled' AND ("player1RefundSignature" IS NOT NULL OR "player2RefundSignature" IS NOT NULL OR "proposalTransactionId" IS NOT NULL))
          OR
          -- Include any matches with refund signatures (covers losing ties and other refund scenarios)
          ("player1RefundSignature" IS NOT NULL OR "player2RefundSignature" IS NOT NULL OR "proposalTransactionId" IS NOT NULL)
          OR
          -- Include matches with player results (covers timeout scenarios and other completed games)
          ("player1Result" IS NOT NULL OR "player2Result" IS NOT NULL)
        )
      ORDER BY "createdAt" DESC
    `);
    

    
    // Helper function to sanitize CSV values (prevent injection)
    const sanitizeCsvValue = (value: any) => {
      if (!value) return '';
      const str = String(value);
      // If value starts with =, +, -, or @, prefix with single quote
      if (/^[=\-+@]/.test(str)) {
        return `'${str}`;
      }
      return str;
    };
    
    // Helper function to generate row hash for integrity
    const generateRowHash = (match: any) => {
      const crypto = require('crypto');
      const data = `${match.id}${match.player1}${match.player2}${match.winner}${match.totalFeesCollected}${match.payoutTxHash || match.refundTxHash || ''}${match.updatedAt}`;
      return crypto.createHash('sha256').update(data).digest('hex');
    };
    
    // Helper function to convert to EST
    const convertToEST = (timestamp: any) => {
      if (!timestamp) return '';
      try {
        return new Date(timestamp).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch (error: unknown) {
        return '';
      }
    };
    
    // Generate CSV headers - Only finished matches with results or refunds
    const csvHeaders = [
      'Match ID',
      'Player 1 Wallet',
      'Player 2 Wallet', 
      'Entry Fee (SOL)',
      'Total Pot (SOL)',
      'Match Status',
      'Winner',
      'Winner Amount (SOL)',
      'Platform Fee (SOL)',
      'Game Completed',
      'Target Word',
      '🔗 SQUADS VAULT 🔗',
      'Squads Vault Address',
      'Player 1 Deposit TX',
      'Player 2 Deposit TX',
      '🔗 GAME RESULTS 🔗',
      'Player 1 Solved',
      'Player 1 Guesses',
      'Player 1 Time (sec)',
      'Player 1 Result Reason',
      'Player 2 Solved',
      'Player 2 Guesses',
      'Player 2 Time (sec)',
      'Player 2 Result Reason',
      '🔗 TIMESTAMPS 🔗',
      'Match Created (EST)',
      'Game Started (EST)',
      'Game Ended (EST)',
      '🔗 PAYOUT TRANSACTIONS 🔗',
      'Executed Transaction Hash',
      'Refund Transaction Hash',
      'Legacy Player 1 Refund TX',
      'Legacy Player 2 Refund TX',
      '🔗 SQUADS PROPOSAL INFO 🔗',
      'Proposal ID',
      'Proposal Status',
      'Proposal Created At',
      'Needs Signatures',
      '🔗 EXPLORER LINKS 🔗',
      'Squads Vault Link',
      'Player 1 Deposit Link',
      'Player 2 Deposit Link',
      'Executed Transaction Link',
      'Refund Transaction Link',
      'Legacy Player 1 Refund Link',
      'Legacy Player 2 Refund Link'
    ];
    
    // Generate CSV rows with available data
    const csvRows = matches.map((match: any) => {
      // Determine explorer network
      const network = getExplorerNetwork();
      
      // Parse player results for meaningful data
      const player1Result = match.player1Result ? JSON.parse(match.player1Result) : null;
      const player2Result = match.player2Result ? JSON.parse(match.player2Result) : null;
      const payoutResult = match.payoutResult ? JSON.parse(match.payoutResult) : null;
      

      

      
      // Calculate total pot and amounts based on match status
      const totalPot = match.entryFee * 2;
      let winnerAmount = 0;
      let platformFee = 0;
      let winner = '';
      
      if (match.status === 'completed' && payoutResult) {
        winnerAmount = payoutResult.winnerAmount || 0;
        platformFee = payoutResult.feeAmount || 0;
        winner = payoutResult.winner || '';
      } else if (match.status === 'cancelled') {
        // For cancelled matches, show refund amounts
        winnerAmount = 0; // No winner
        platformFee = 0; // No platform fee for cancelled matches
        winner = 'cancelled';
      }
      
      return [
        sanitizeCsvValue(match.id),
        sanitizeCsvValue(match.player1),
        sanitizeCsvValue(match.player2),
        sanitizeCsvValue(match.entryFee),
        sanitizeCsvValue(totalPot),
        sanitizeCsvValue(match.status),
        sanitizeCsvValue(winner),
        sanitizeCsvValue(winnerAmount),
        sanitizeCsvValue(platformFee),
        sanitizeCsvValue(match.status === 'completed' ? 'Yes' : 'No'),
        sanitizeCsvValue(match.status === 'completed' ? match.word : 'GAME_CANCELLED'),
        '', // 🔗 SQUADS VAULT 🔗
        sanitizeCsvValue(match.squadsVaultAddress),
        sanitizeCsvValue(match.depositATx),
        sanitizeCsvValue(match.depositBTx),
        '', // 🔗 GAME RESULTS 🔗
        sanitizeCsvValue((player1Result && player1Result.won) ? 'Yes' : (player1Result ? 'No' : 'N/A')),
        sanitizeCsvValue(player1Result && player1Result.numGuesses ? player1Result.numGuesses : ''),
        sanitizeCsvValue(player1Result && player1Result.totalTime ? Math.round(player1Result.totalTime / 1000) : ''),
        sanitizeCsvValue(player1Result && player1Result.reason ? player1Result.reason : ''),
        sanitizeCsvValue((player2Result && player2Result.won) ? 'Yes' : (player2Result ? 'No' : 'N/A')),
        sanitizeCsvValue(player2Result && player2Result.numGuesses ? player2Result.numGuesses : ''),
        sanitizeCsvValue(player2Result && player2Result.totalTime ? Math.round(player2Result.totalTime / 1000) : ''),
        sanitizeCsvValue(player2Result && player2Result.reason ? player2Result.reason : ''),
        '', // 🔗 TIMESTAMPS 🔗
        convertToEST(match.createdAt),
        convertToEST(match.gameStartTimeUtc),
        convertToEST(match.gameEndTimeUtc),
        '', // 🔗 PAYOUT TRANSACTIONS 🔗
        sanitizeCsvValue(match.proposalTransactionId),
        sanitizeCsvValue(match.proposalTransactionId),
        sanitizeCsvValue(''), // No longer used - refunds go through proposals
        sanitizeCsvValue(''), // No longer used - refunds go through proposals
        '', // 🔗 SQUADS PROPOSAL INFO 🔗
        sanitizeCsvValue(match.payoutProposalId || ''),
        sanitizeCsvValue(match.proposalStatus || ''),
        sanitizeCsvValue(match.proposalCreatedAt ? convertToEST(match.proposalCreatedAt) : ''),
        sanitizeCsvValue(match.needsSignatures || ''),
        '', // 🔗 EXPLORER LINKS 🔗
        match.squadsVaultAddress ? `https://explorer.solana.com/address/${match.squadsVaultAddress}?cluster=${network}` : '',
        match.depositATx ? `https://explorer.solana.com/tx/${match.depositATx}?cluster=${network}` : '',
        match.depositBTx ? `https://explorer.solana.com/tx/${match.depositBTx}?cluster=${network}` : '',
        match.proposalTransactionId ? `https://explorer.solana.com/tx/${match.proposalTransactionId}?cluster=${network}` : '',
        match.proposalTransactionId ? `https://explorer.solana.com/tx/${match.proposalTransactionId}?cluster=${network}` : '',
        '', // No longer used - refunds go through proposals
        '' // No longer used - refunds go through proposals
      ];
    });
    
    // Combine headers and rows
    const csvContent = [csvHeaders, ...csvRows]
      .map((row: any) => row.map((field: any) => `"${field || ''}"`).join(','))
      .join('\n');
    
    // Generate file hash for integrity
    const crypto = require('crypto');
    const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');
    
    // Set response headers for CSV download
    const filename = `guess5_matches_${startDate}${endDate ? '_to_' + endDate : ''}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-File-Hash', fileHash);
    
    console.log(`✅ Secure report generated: ${filename} with ${matches.length} finished matches (completed games or cancelled games with refunds)`);
    console.log(`🔐 File integrity hash: ${fileHash}`);
    
    res.send(csvContent);
    
  } catch (error: unknown) {
    console.error('❌ Error generating secure report:', error);
    res.status(500).json({ error: 'Failed to generate secure report' });
  }
};

// Blockchain verification endpoint
const verifyBlockchainDataHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;
    
    console.log(`🔍 Verifying blockchain data for match ${matchId}...`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    // Update match with blockchain data
    const updatedMatch = await updateMatchWithBlockchainData(match);
    
    if (updatedMatch) {
      res.json({
        success: true,
        message: 'Match verified with blockchain data',
        match: {
          id: updatedMatch.id,
          totalFeesCollected: updatedMatch.totalFeesCollected,
          totalFeesCollectedUSD: updatedMatch.totalFeesCollectedUSD,
          platformFee: updatedMatch.platformFee,
          platformFeeUSD: updatedMatch.platformFeeUSD,
          networkFees: updatedMatch.networkFees,
          taxableIncome: updatedMatch.taxableIncome,
          solPriceAtTransaction: updatedMatch.solPriceAtTransaction
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to verify blockchain data' });
    }
    
  } catch (error: unknown) {
    console.error('❌ Error verifying blockchain data:', error);
    res.status(500).json({ error: 'Failed to verify blockchain data' });
  }
};

// Track active SSE connections
const activeSSEConnections = new Map<string, { count: number; lastActivity: number }>();

// Cleanup stale connections every 5 minutes
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes
  
  for (const [wallet, connection] of activeSSEConnections.entries()) {
    if (now - connection.lastActivity > staleThreshold) {
      console.log('🧹 Cleaning up stale SSE connection for wallet:', wallet);
      activeSSEConnections.delete(wallet);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Server-Sent Events endpoint for real-time wallet balance updates
const walletBalanceSSEHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Ensure database is initialized
    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in walletBalanceSSEHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }
    
    // Check connection limits (max 3 connections per wallet)
    const walletConnections = activeSSEConnections.get(wallet) || { count: 0, lastActivity: Date.now() };
    if (walletConnections.count >= 3) {
      console.log('⚠️ Too many SSE connections for wallet:', wallet, 'count:', walletConnections.count);
      return res.status(429).json({ error: 'Too many connections for this wallet' });
    }
    
    // Update connection count
    activeSSEConnections.set(wallet, { 
      count: walletConnections.count + 1, 
      lastActivity: Date.now() 
    });
    
    console.log('🔌 SSE connection requested for wallet:', wallet, 'active connections:', walletConnections.count + 1);
    
    // Set SSE headers with proper CORS and connection keep-alive
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Keep-Alive': 'timeout=300, max=1000', // Increased timeout to 5 minutes
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'https://guess5.vercel.app',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    
    // Send initial connection message
    const connectionMessage = {
      type: 'connected',
      wallet: wallet,
      timestamp: new Date().toISOString()
    };
    
    res.write(`data: ${JSON.stringify(connectionMessage)}\n\n`);
    
    // Get initial balance
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    const publicKey = new PublicKey(wallet);
    
    try {
      const balance = await connection.getBalance(publicKey);
      const balanceInSOL = balance / LAMPORTS_PER_SOL;
      
      const balanceMessage = {
        type: 'balance_update',
        wallet: wallet,
        balance: balanceInSOL,
        timestamp: new Date().toISOString()
      };
      
      res.write(`data: ${JSON.stringify(balanceMessage)}\n\n`);
    } catch (error: unknown) {
      console.error('❌ Error fetching initial balance:', error);
      const errorMessage = {
        type: 'error',
        wallet: wallet,
        message: 'Failed to fetch initial balance',
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
    }
    
    // Set up periodic balance checks (every 30 seconds) and heartbeat (every 10 seconds)
    const balanceInterval = setInterval(async () => {
      try {
        const balance = await connection.getBalance(publicKey);
        const balanceInSOL = balance / LAMPORTS_PER_SOL;
        
        const balanceMessage = {
          type: 'balance_update',
          wallet: wallet,
          balance: balanceInSOL,
          timestamp: new Date().toISOString()
        };
        
        res.write(`data: ${JSON.stringify(balanceMessage)}\n\n`);
      } catch (error: unknown) {
        console.error('❌ Error fetching balance update:', error);
        const errorMessage = {
          type: 'error',
          wallet: wallet,
          message: 'Failed to fetch balance update',
          timestamp: new Date().toISOString()
        };
        res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
      }
    }, 30000); // Check every 30 seconds (reduced frequency)
    
    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        const heartbeatMessage = {
          type: 'heartbeat',
          wallet: wallet,
          timestamp: new Date().toISOString()
        };
        res.write(`data: ${JSON.stringify(heartbeatMessage)}\n\n`);
      } catch (error: unknown) {
        console.error('❌ Error sending heartbeat:', error);
        // If we can't send heartbeat, connection is likely dead
        clearInterval(balanceInterval);
        clearInterval(heartbeatInterval);
      }
    }, 10000); // Heartbeat every 10 seconds (more frequent)
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('🔌 SSE connection closed for wallet:', wallet);
      clearInterval(balanceInterval);
      clearInterval(heartbeatInterval);
      
      // Decrement connection count
      const walletConnections = activeSSEConnections.get(wallet);
      if (walletConnections) {
        walletConnections.count = Math.max(0, walletConnections.count - 1);
        if (walletConnections.count === 0) {
          activeSSEConnections.delete(wallet);
        } else {
          activeSSEConnections.set(wallet, walletConnections);
        }
      }
    });
    
    // Handle server shutdown
    req.on('error', (error: any) => {
      console.error('❌ SSE connection error:', error);
      clearInterval(balanceInterval);
      clearInterval(heartbeatInterval);
      
      // Decrement connection count
      const walletConnections = activeSSEConnections.get(wallet);
      if (walletConnections) {
        walletConnections.count = Math.max(0, walletConnections.count - 1);
        if (walletConnections.count === 0) {
          activeSSEConnections.delete(wallet);
        } else {
          activeSSEConnections.set(wallet, walletConnections);
        }
      }
    });
    
    // Handle connection timeout
    req.setTimeout(300000, () => { // 5 minutes timeout
      console.log('⏰ SSE connection timeout for wallet:', wallet);
      clearInterval(balanceInterval);
      clearInterval(heartbeatInterval);
      if (!res.headersSent) {
        res.status(408).end();
      }
    });
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Error in wallet balance SSE handler:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        details: errorMessage,
        wallet: req.params.wallet 
      });
    } else {
      const errorMessage = {
        type: 'error',
        wallet: req.params.wallet || 'unknown',
        message: 'Internal server error',
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
    }
  }
};

// Multisig vault integration handlers

/**
 * Handle player deposit to multisig vault
 */
const depositToMultisigVaultHandler = async (req: any, res: any) => {
  try {
    const { matchId, playerWallet, amount, depositTxSignature } = req.body;

    if (!matchId || !playerWallet || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: matchId, playerWallet, and amount' 
      });
    }

    console.log('💰 Processing multisig vault deposit request:', { matchId, playerWallet, amount, depositTxSignature });

    // Verify deposit on Solana using Squads service
    const result = await squadsVaultService.verifyDeposit(matchId, playerWallet, amount, depositTxSignature);

    if (result.success) {
      console.log('✅ Multisig vault deposit verified successfully:', {
        matchId,
        playerWallet,
        transactionId: result.transactionId
      });

      // Get match from database to update payment status
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match) {
        return res.status(404).json({ 
          success: false,
          error: 'Match not found' 
        });
      }

      // Determine which player made the deposit
      const isPlayer1 = playerWallet === match.player1;

      // Mark player as paid
      if (isPlayer1) {
        match.player1Paid = true;
        console.log(`✅ Marked Player 1 (${playerWallet}) as paid for match ${matchId}`);
      } else {
        match.player2Paid = true;
        console.log(`✅ Marked Player 2 (${playerWallet}) as paid for match ${matchId}`);
      }

      // Check if both players have paid
      const bothPaid = match.player1Paid && match.player2Paid;

      if (bothPaid) {
        // Both players have paid - ensure match is active
        if (match.status !== 'active') {
          console.log(`🎮 Both players have paid for match ${matchId}, activating game...`);
          match.status = 'active';
          
          // Ensure word is set if not already present
          if (!match.word) {
            const { getRandomWord } = require('../wordList');
            match.word = getRandomWord();
          }
          
          // Set game start time if not already set
          if (!match.gameStartTime) {
            match.gameStartTime = new Date();
          }
        }
      }

      // Save match to database
      await matchRepository.save(match);

      console.log(`🔍 Payment status for match ${matchId}:`, {
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        status: match.status,
        bothPaid
      });

      // Send WebSocket event for payment received
      try {
        const { websocketService } = require('../services/websocketService');
        const { WebSocketEventType } = require('../services/websocketService');
        websocketService.broadcastToMatch(matchId, {
          type: WebSocketEventType.PAYMENT_RECEIVED,
          matchId,
          data: {
            player: isPlayer1 ? 'player1' : 'player2',
            wallet: playerWallet,
            amount: amount,
            player1Paid: match.player1Paid,
            player2Paid: match.player2Paid,
            status: match.status
          },
          timestamp: new Date().toISOString()
        });
      } catch (wsError) {
        console.error('⚠️ Failed to send WebSocket event (non-critical):', wsError);
      }

      res.json({
        success: true,
        message: 'Deposit verified successfully',
        transactionId: result.transactionId,
        matchId,
        playerWallet,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        status: match.status,
        bothPaid
      });
    } else {
      console.error('❌ Multisig vault deposit failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in depositToMultisigVaultHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Handle match settlement on smart contract
 */
const settleMatchHandler = async (req: any, res: any) => {
  try {
    const { matchId, result } = req.body;

    if (!matchId || !result) {
      return res.status(400).json({ 
        error: 'Missing required fields: matchId and result' 
      });
    }

    // Validate result type
    const validResults = ['Player1', 'Player2', 'WinnerTie', 'LosingTie', 'Timeout', 'Error'];
    if (!validResults.includes(result)) {
      return res.status(400).json({ 
        error: `Invalid result type: ${result}. Must be one of: ${validResults.join(', ')}` 
      });
    }

    console.log('🏁 Processing smart contract settlement:', { matchId, result });

    // Get smart contract service
    const { getSmartContractService } = require('../services/smartContractService');
    const smartContractService = getSmartContractService();

    // Settle match
    const settlementResult = await smartContractService.settleMatch(matchId, result);

    if (settlementResult.success) {
      console.log('✅ Smart contract settlement processed successfully:', {
        matchId,
        result,
        transactionId: settlementResult.transactionId
      });

      // Update database match status
      try {
        const { AppDataSource } = require('../db/index');
        const { Match } = require('../models/Match');
        const matchRepository = AppDataSource.getRepository(Match);
        
        const match = await matchRepository.findOne({ where: { id: matchId } });
        if (match) {
          match.status = 'completed';
          match.smartContractStatus = 'Settled';
          match.winner = result === 'Player1' ? match.player1 : 
                        result === 'Player2' ? match.player2 : 'tie';
          match.isCompleted = true;
          match.matchOutcome = result;
          
          await matchRepository.save(match);
          console.log('✅ Database match status updated');
        }
      } catch (dbError) {
        console.error('⚠️ Failed to update database match status:', dbError);
        // Don't fail the request if database update fails
      }

      res.json({
        success: true,
        message: 'Match settled successfully on smart contract',
        transactionId: settlementResult.transactionId,
        matchId,
        result
      });
    } else {
      console.error('❌ Smart contract settlement failed:', settlementResult.error);
      res.status(500).json({
        success: false,
        error: settlementResult.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in settleMatchHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Get smart contract status for a match
 */
const getSmartContractStatusHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: matchId' 
      });
    }

    console.log('🔍 Getting smart contract status for match:', matchId);

    // Get smart contract service
    const { getSmartContractService } = require('../services/smartContractService');
    const smartContractService = getSmartContractService();

    // Get match status
    const statusResult = await smartContractService.getMatchStatus(new PublicKey(matchId));

    if (statusResult.success) {
      console.log('✅ Smart contract status retrieved:', {
        matchId,
        onChainStatus: statusResult.onChainStatus,
        vaultBalance: statusResult.vaultBalance
      });

      res.json({
        success: true,
        matchId,
        onChainStatus: statusResult.onChainStatus,
        vaultBalance: statusResult.vaultBalance,
        player1Deposited: statusResult.player1Deposited,
        player2Deposited: statusResult.player2Deposited
      });
    } else {
      console.error('❌ Failed to get smart contract status:', statusResult.error);
      res.status(500).json({
        success: false,
        error: statusResult.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in getSmartContractStatusHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Verify a deposit transaction on the smart contract
 */
const verifyDepositHandler = async (req: any, res: any) => {
  try {
    const { matchId, playerWallet, transactionSignature } = req.body;

    if (!matchId || !playerWallet || !transactionSignature) {
      return res.status(400).json({ 
        error: 'Missing required fields: matchId, playerWallet, and transactionSignature' 
      });
    }

    console.log('🔍 Verifying deposit transaction:', { matchId, playerWallet, transactionSignature });

    // Get deposit service
    const { getSmartContractDepositService } = require('../services/smartContractDepositService');
    const depositService = getSmartContractDepositService();

    // Verify deposit
    const result = await depositService.verifyDeposit(matchId, playerWallet, transactionSignature);

    if (result.success) {
      console.log('✅ Deposit verification successful:', {
        matchId,
        playerWallet,
        deposited: result.deposited,
        transactionSignature: result.transactionSignature
      });

      res.json({
        success: true,
        deposited: result.deposited,
        transactionSignature: result.transactionSignature,
        matchId,
        playerWallet
      });
    } else {
      console.error('❌ Deposit verification failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in verifyDepositHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Get deposit status for a match
 */
const getDepositStatusHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: matchId' 
      });
    }

    console.log('🔍 Getting deposit status for match:', matchId);

    // Get deposit service
    const { getSmartContractDepositService } = require('../services/smartContractDepositService');
    const depositService = getSmartContractDepositService();

    // Get deposit status
    const result = await depositService.getDepositStatus(matchId);

    if (result.success) {
      console.log('✅ Deposit status retrieved:', {
        matchId,
        player1Deposited: result.player1Deposited,
        player2Deposited: result.player2Deposited,
        vaultBalance: result.vaultBalance
      });

      res.json({
        success: true,
        matchId,
        player1Deposited: result.player1Deposited,
        player2Deposited: result.player2Deposited,
        vaultBalance: result.vaultBalance
      });
    } else {
      console.error('❌ Failed to get deposit status:', result.error);
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in getDepositStatusHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

// Admin endpoint to void/reset a problematic match
const voidMatchHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID required' });
    }

    console.log('🗑️ Voiding match:', matchId);

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Delete the match
    await matchRepository.remove(match);

    // Also clear Redis game state if it exists
    try {
      const { deleteGameState } = require('../utils/redisGameState');
      await deleteGameState(matchId);
    } catch (redisError) {
      console.warn('⚠️ Could not delete Redis game state:', redisError);
    }

    console.log('✅ Match voided successfully:', matchId);

    res.json({
      success: true,
      message: 'Match voided successfully',
      matchId
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error voiding match:', error);
    res.status(500).json({ error: 'Failed to void match', details: errorMessage });
  }
};

// Get approval transaction to sign (for frontend)
const getProposalApprovalTransactionHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet } = req.query;
    
    if (!matchId || !wallet) {
      return res.status(400).json({ error: 'Missing required fields: matchId, wallet' });
    }

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Verify player is part of this match
    const isPlayer1 = wallet === match.player1;
    const isPlayer2 = wallet === match.player2;
    
    if (!isPlayer1 && !isPlayer2) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }

    // Check if match has a payout proposal
    if (!(match as any).squadsVaultAddress || !(match as any).payoutProposalId) {
      return res.status(400).json({ error: 'No payout proposal exists for this match' });
    }

    // Verify player hasn't already signed
    const signers = match.getProposalSigners();
    if (signers.includes(wallet)) {
      return res.status(400).json({ error: 'You have already signed this proposal' });
    }

    // Build the approval transaction using Squads SDK (backend has access to rpc)
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction, TransactionInstruction } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // CRITICAL: Use the same program ID that was used to create the multisig
    // Get it from the Squads service to ensure consistency
    const { PROGRAM_ID } = require('@sqds/multisig');
    let programId;
    try {
      if (process.env.SQUADS_PROGRAM_ID) {
        try {
          programId = new PublicKey(process.env.SQUADS_PROGRAM_ID);
          console.log('✅ Using SQUADS_PROGRAM_ID from environment:', programId.toString());
        } catch (pkError: any) {
          console.warn('⚠️ Invalid SQUADS_PROGRAM_ID, using SDK default', pkError?.message);
          programId = PROGRAM_ID;
        }
      } else {
        programId = PROGRAM_ID;
        console.log('✅ Using SDK default PROGRAM_ID:', programId.toString());
      }
    } catch (progIdError: any) {
      console.error('❌ Failed to get program ID:', progIdError?.message);
      throw new Error(`Failed to get program ID: ${progIdError?.message || String(progIdError)}`);
    }

    console.log('🔍 Building approval transaction:', {
      matchId,
      wallet,
      squadsVaultAddress: (match as any).squadsVaultAddress,
      payoutProposalId: (match as any).payoutProposalId,
      programId: programId.toString(),
    });

    let multisigAddress;
    let transactionIndex;
    let memberPublicKey;
    
    try {
      multisigAddress = new PublicKey((match as any).squadsVaultAddress);
      transactionIndex = BigInt((match as any).payoutProposalId);
      memberPublicKey = new PublicKey(wallet);
    } catch (keyError: any) {
      console.error('❌ Failed to create PublicKey instances:', keyError?.message);
      throw new Error(`Invalid address format: ${keyError?.message || String(keyError)}`);
    }

    // Get recent blockhash
    let blockhash;
    let lastValidBlockHeight;
    try {
      const blockhashResult = await connection.getLatestBlockhash('confirmed');
      blockhash = blockhashResult.blockhash;
      lastValidBlockHeight = blockhashResult.lastValidBlockHeight;
    } catch (blockhashError: any) {
      console.error('❌ Failed to get blockhash:', blockhashError?.message);
      throw new Error(`Failed to get blockhash: ${blockhashError?.message || String(blockhashError)}`);
    }

    // Use SDK helpers with the correct program ID
    // Note: getVaultTransactionPda might not be exported, so we'll derive manually
    const { getMemberPda } = require('@sqds/multisig');
    const crypto = require('crypto');
    
    // Derive transaction PDA manually (matches Squads SDK derivation)
    // Transaction PDA = [multisig, transaction_index (u64), "transaction"]
    let transactionPda;
    try {
      // Convert transaction index to 8-byte little-endian buffer
      const indexBuffer = Buffer.alloc(8);
      indexBuffer.writeBigUInt64LE(transactionIndex, 0);
      
      // Derive PDA: [multisigAddress, transactionIndex (u64), "transaction"]
      const [pda] = PublicKey.findProgramAddressSync(
        [
          multisigAddress.toBuffer(),
          indexBuffer,
          Buffer.from('transaction'),
        ],
        programId
      );
      transactionPda = pda;
      console.log('✅ Transaction PDA derived manually:', transactionPda.toString());
    } catch (pdaError: any) {
      console.error('❌ Failed to derive transaction PDA:', {
        error: pdaError?.message,
        stack: pdaError?.stack,
        multisigAddress: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        programId: programId.toString(),
      });
      throw new Error(`Failed to derive transaction PDA: ${pdaError?.message || String(pdaError)}`);
    }
    
    // Derive member PDA using SDK helper with correct program ID
    let memberPda;
    try {
      try {
        // Try with programId parameter first
        if (typeof getMemberPda === 'function') {
          const result = getMemberPda({
            multisig: multisigAddress,
            memberKey: memberPublicKey,
            programId: programId,
          } as any);
          // Check if result is an array (PDA tuple) or single value
          if (Array.isArray(result)) {
            memberPda = result[0];
          } else {
            memberPda = result;
          }
          console.log('✅ Member PDA derived with programId:', memberPda.toString());
        } else {
          throw new Error('getMemberPda is not a function');
        }
      } catch (pdaError: any) {
        // Fallback if programId parameter not supported or function doesn't exist
        console.warn('⚠️ getMemberPda with programId failed, trying without or deriving manually:', pdaError?.message);
        
        if (typeof getMemberPda === 'function') {
          try {
            const result = getMemberPda({
              multisig: multisigAddress,
              memberKey: memberPublicKey,
            });
            if (Array.isArray(result)) {
              memberPda = result[0];
            } else {
              memberPda = result;
            }
            console.log('✅ Member PDA derived without programId:', memberPda.toString());
          } catch (fallbackError: any) {
            // Final fallback: derive manually
            console.warn('⚠️ SDK getMemberPda failed, deriving manually:', fallbackError?.message);
            // Member PDA = [multisig, member_key, "member"]
            const [pda] = PublicKey.findProgramAddressSync(
              [
                multisigAddress.toBuffer(),
                memberPublicKey.toBuffer(),
                Buffer.from('member'),
              ],
              programId
            );
            memberPda = pda;
            console.log('✅ Member PDA derived manually:', memberPda.toString());
          }
        } else {
          // getMemberPda doesn't exist, derive manually
          const [pda] = PublicKey.findProgramAddressSync(
            [
              multisigAddress.toBuffer(),
              memberPublicKey.toBuffer(),
              Buffer.from('member'),
            ],
            programId
          );
          memberPda = pda;
          console.log('✅ Member PDA derived manually (SDK function not available):', memberPda.toString());
        }
      }
    } catch (pdaError: any) {
      console.error('❌ Failed to derive member PDA:', {
        error: pdaError?.message,
        stack: pdaError?.stack,
        multisigAddress: multisigAddress.toString(),
        memberKey: memberPublicKey.toString(),
        programId: programId.toString(),
      });
      throw new Error(`Failed to derive member PDA: ${pdaError?.message || String(pdaError)}`);
    }
    
    // Calculate Anchor instruction discriminator: sha256("global:vault_transaction_approve")[0:8]
    const discriminatorSeed = 'global:vault_transaction_approve';
    const hash = crypto.createHash('sha256').update(discriminatorSeed).digest();
    const discriminator = hash.slice(0, 8);
    
    // Transaction index as 8-byte little-endian u64
    const indexBuffer = Buffer.alloc(8);
    indexBuffer.writeBigUInt64LE(transactionIndex, 0);
    
    const instructionData = Buffer.concat([discriminator, indexBuffer]);
    
    let approveIx;
    try {
      approveIx = new TransactionInstruction({
        programId: programId, // Use network-specific program ID (must match multisig creation!)
        keys: [
          { pubkey: multisigAddress, isSigner: false, isWritable: false },
          { pubkey: transactionPda, isSigner: false, isWritable: true },
          { pubkey: memberPda, isSigner: false, isWritable: false },
          { pubkey: memberPublicKey, isSigner: true, isWritable: false },
        ],
        data: instructionData,
      });
      console.log('✅ Approval instruction created');
    } catch (ixError: any) {
      console.error('❌ Failed to create approval instruction:', {
        error: ixError?.message,
        stack: ixError?.stack,
        programId: programId.toString(),
      });
      throw new Error(`Failed to create approval instruction: ${ixError?.message || String(ixError)}`);
    }
    
    let messageV0;
    try {
      messageV0 = new TransactionMessage({
        payerKey: memberPublicKey,
        recentBlockhash: blockhash,
        instructions: [approveIx],
      }).compileToV0Message();
      console.log('✅ Transaction message compiled');
    } catch (msgError: any) {
      console.error('❌ Failed to compile transaction message:', {
        error: msgError?.message,
        stack: msgError?.stack,
      });
      throw new Error(`Failed to compile transaction message: ${msgError?.message || String(msgError)}`);
    }
    
    let transaction;
    try {
      transaction = new VersionedTransaction(messageV0);
      console.log('✅ Versioned transaction created');
    } catch (txError: any) {
      console.error('❌ Failed to create versioned transaction:', {
        error: txError?.message,
        stack: txError?.stack,
      });
      throw new Error(`Failed to create versioned transaction: ${txError?.message || String(txError)}`);
    }

    // Serialize the transaction for the frontend to sign
    let serialized;
    let base64Tx;
    try {
      serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      base64Tx = Buffer.from(serialized).toString('base64');
      console.log('✅ Transaction serialized, length:', base64Tx.length);
    } catch (serializeError: any) {
      console.error('❌ Failed to serialize transaction:', {
        error: serializeError?.message,
        stack: serializeError?.stack,
      });
      throw new Error(`Failed to serialize transaction: ${serializeError?.message || String(serializeError)}`);
    }

    res.json({
      transaction: base64Tx,
      matchId,
      proposalId: (match as any).payoutProposalId,
      vaultAddress: (match as any).squadsVaultAddress,
    });

  } catch (error: unknown) {
    console.error('❌ Error building approval transaction:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      matchId: req.query?.matchId,
      wallet: req.query?.wallet,
    });
    res.status(500).json({ error: 'Failed to build approval transaction', details: errorMessage });
  }
};

const signProposalHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, signedTransaction } = req.body;
    
    if (!matchId || !wallet || !signedTransaction) {
      return res.status(400).json({ error: 'Missing required fields: matchId, wallet, signedTransaction' });
    }

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Verify player is part of this match
    const isPlayer1 = wallet === match.player1;
    const isPlayer2 = wallet === match.player2;
    
    if (!isPlayer1 && !isPlayer2) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }

    // Check if match has a payout proposal
    if (!(match as any).squadsVaultAddress || !(match as any).payoutProposalId) {
      return res.status(400).json({ error: 'No payout proposal exists for this match' });
    }

    // Verify player hasn't already signed
    const signers = match.getProposalSigners();
    if (signers.includes(wallet)) {
      return res.status(400).json({ error: 'You have already signed this proposal' });
    }

    console.log('📝 Processing signed proposal:', {
      matchId,
      wallet,
      signedTransactionLength: signedTransaction?.length,
      squadsVaultAddress: (match as any).squadsVaultAddress,
      payoutProposalId: (match as any).payoutProposalId,
    });

    // Submit the signed transaction
    const { Connection, VersionedTransaction } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // Deserialize the signed transaction
    let transaction;
    try {
      const signedTxBuffer = Buffer.from(signedTransaction, 'base64');
      transaction = VersionedTransaction.deserialize(signedTxBuffer);
      console.log('✅ Transaction deserialized successfully');
    } catch (deserializeError: any) {
      console.error('❌ Failed to deserialize signed transaction:', {
        error: deserializeError?.message,
        stack: deserializeError?.stack,
        signedTransactionLength: signedTransaction?.length,
      });
      throw new Error(`Failed to deserialize transaction: ${deserializeError?.message || String(deserializeError)}`);
    }
    
    // Send and confirm the transaction
    let signature;
    try {
      const serializedTx = transaction.serialize();
      console.log('📤 Sending signed transaction to network...');
      signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log('✅ Transaction sent, signature:', signature);
    } catch (sendError: any) {
      console.error('❌ Failed to send transaction:', {
        error: sendError?.message,
        stack: sendError?.stack,
        errorCode: sendError?.code,
        errorName: sendError?.name,
      });
      throw new Error(`Failed to send transaction: ${sendError?.message || String(sendError)}`);
    }

    // Wait for confirmation
    let confirmation;
    try {
      console.log('⏳ Waiting for transaction confirmation...');
      confirmation = await connection.confirmTransaction(signature, 'confirmed');
      console.log('✅ Transaction confirmed:', {
        signature,
        slot: confirmation.context.slot,
        hasError: !!confirmation.value.err,
      });
    } catch (confirmError: any) {
      console.error('❌ Failed to confirm transaction:', {
        error: confirmError?.message,
        stack: confirmError?.stack,
        signature,
      });
      throw new Error(`Failed to confirm transaction: ${confirmError?.message || String(confirmError)}`);
    }
    
    if (confirmation.value.err) {
      const errorDetails = JSON.stringify(confirmation.value.err);
      console.error('❌ Transaction failed on-chain:', {
        signature,
        error: errorDetails,
        slot: confirmation.context.slot,
      });
      throw new Error(`Transaction failed: ${errorDetails}`);
    }

    console.log('✅ Proposal signed successfully', {
      matchId,
      wallet,
      signature,
      proposalId: (match as any).payoutProposalId,
    });

    // Update match with new signer
    try {
      match.addProposalSigner(wallet);
      
      // Update needsSignatures count
      const currentNeedsSignatures = (match as any).needsSignatures || 2;
      (match as any).needsSignatures = Math.max(0, currentNeedsSignatures - 1);
      
      // If enough signatures, mark as ready to execute
      if ((match as any).needsSignatures === 0) {
        (match as any).proposalStatus = 'READY_TO_EXECUTE';
      } else {
        (match as any).proposalStatus = 'ACTIVE';
      }

      await matchRepository.save(match);
      console.log('✅ Match updated with signer:', {
        matchId,
        wallet,
        needsSignatures: (match as any).needsSignatures,
        proposalStatus: (match as any).proposalStatus,
      });
    } catch (dbError: any) {
      console.error('❌ Failed to update match in database:', {
        error: dbError?.message,
        stack: dbError?.stack,
        matchId,
        wallet,
      });
      // Don't fail the request if DB update fails - transaction was already submitted
      console.warn('⚠️ Transaction was submitted but database update failed');
    }

    res.json({
      success: true,
      signature,
      proposalId: (match as any).payoutProposalId,
      needsSignatures: (match as any).needsSignatures,
      proposalStatus: (match as any).proposalStatus,
    });

  } catch (error: unknown) {
    console.error('❌ Error signing proposal:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      matchId: req.body?.matchId,
      wallet: req.body?.wallet,
      hasSignedTransaction: !!req.body?.signedTransaction,
      signedTransactionLength: req.body?.signedTransaction?.length,
    });
    res.status(500).json({ error: 'Failed to sign proposal', details: errorMessage });
  }
};

module.exports = {
  requestMatchHandler,
  submitResultHandler,
  getMatchStatusHandler,
  getProposalApprovalTransactionHandler,
  signProposalHandler,
  checkPlayerMatchHandler,
  debugWaitingPlayersHandler,
  debugMatchesHandler,
  matchTestHandler,
  testRepositoryHandler,
  testDatabaseHandler,
  cleanupSelfMatchesHandler,
  confirmEscrowHandler,
  submitGameGuessHandler,
  getGameStateHandler,
  executePaymentHandler,
  createEscrowTransactionHandler,
  cleanupStuckMatchesHandler,
  simpleCleanupHandler,
  forceCleanupForWallet,
  confirmPaymentHandler,
  memoryStatsHandler,
  debugMatchmakingHandler,
  manualRefundHandler,
  manualMatchHandler,
  clearMatchmakingDataHandler,
  runMigrationHandler,
  generateReportHandler,
  verifyBlockchainDataHandler,
  processAutomatedRefunds,
  walletBalanceSSEHandler,
  verifyPaymentTransaction,

  // findAndClaimWaitingPlayer, // Removed - replaced with Redis matchmaking
  websocketStatsHandler,

  // Multisig vault integration handlers
  depositToMultisigVaultHandler,
  checkPendingClaimsHandler,
  voidMatchHandler,
};

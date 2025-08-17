const expressMatch = require('express');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');
const { Not, LessThan, Between } = require('typeorm');
const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
// Remove escrow imports - we're using direct payments now
// const { createEscrowAccount, payout, refundEscrow } = require('../services/payoutService');

// Memory limits to prevent attacks
const MAX_ACTIVE_GAMES = 1000;
const MAX_MATCHMAKING_LOCKS = 500;
const MAX_IN_MEMORY_MATCHES = 100;

// In-memory storage for matches that couldn't be saved to database
const inMemoryMatches = new Map();

// Server-side game state tracking with improved memory management
const activeGames = new Map<string, {
  startTime: number;
  player1StartTime: number;
  player2StartTime: number;
  player1Guesses: string[];
  player2Guesses: string[];
  player1Solved: boolean;
  player2Solved: boolean;
  word: string;
  matchId: string;
  lastActivity: number; // Track last activity for cleanup
  completed: boolean; // Track if game is completed
  cleanupTimeout?: NodeJS.Timeout; // Add timeout reference
}>();

// Matchmaking locks with improved race condition prevention
const matchmakingLocks = new Map<string, {
  promise: Promise<any>;
  timestamp: number;
  wallet: string;
  entryFee: number;
}>();

// Memory monitoring
let memoryStats = {
  activeGames: 0,
  matchmakingLocks: 0,
  inMemoryMatches: 0,
  lastCleanup: Date.now()
};

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
  } catch (error) {
    console.error('❌ Error checking fee wallet balance:', error);
    return false;
  }
};

// Memory limit check function
const checkMemoryLimits = () => {
  const currentStats = {
    activeGames: activeGames.size,
    matchmakingLocks: matchmakingLocks.size,
    inMemoryMatches: inMemoryMatches.size
  };

  // Update memory stats
  memoryStats = {
    ...currentStats,
    lastCleanup: Date.now()
  };

  // Check limits and log warnings
  if (currentStats.activeGames > MAX_ACTIVE_GAMES * 0.8) {
    console.warn(`⚠️ High active games count: ${currentStats.activeGames}/${MAX_ACTIVE_GAMES}`);
  }
  
  if (currentStats.matchmakingLocks > MAX_MATCHMAKING_LOCKS * 0.8) {
    console.warn(`⚠️ High matchmaking locks count: ${currentStats.matchmakingLocks}/${MAX_MATCHMAKING_LOCKS}`);
  }
  
  if (currentStats.inMemoryMatches > MAX_IN_MEMORY_MATCHES * 0.8) {
    console.warn(`⚠️ High in-memory matches count: ${currentStats.inMemoryMatches}/${MAX_IN_MEMORY_MATCHES}`);
  }

  return currentStats;
};

// IDEMPOTENCY: Generate unique idempotency key
const generateIdempotencyKey = (wallet: string, action: string, matchId?: string) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${wallet}-${action}-${matchId || 'new'}-${timestamp}-${random}`;
};

// IDEMPOTENCY: Check if request is duplicate
const checkIdempotency = async (matchRepository: any, idempotencyKey: string) => {
  try {
    const existingMatch = await matchRepository.findOne({
      where: { idempotencyKey: idempotencyKey }
    });
    
    if (existingMatch) {
      console.log(`🔄 IDEMPOTENCY: Duplicate request detected for key: ${idempotencyKey}`);
      return {
        isDuplicate: true,
        existingMatch: existingMatch
      };
    }
    
    return { isDuplicate: false };
  } catch (error) {
    console.error('❌ IDEMPOTENCY: Error checking idempotency:', error);
    return { isDuplicate: false, error: error.message };
  }
};

// IDEMPOTENCY: Mark request as processed
const markIdempotencyProcessed = async (matchRepository: any, matchId: string, idempotencyKey: string) => {
  try {
    await matchRepository.query(`
      UPDATE "match" 
      SET "idempotencyKey" = $1, "updatedAt" = $2
      WHERE id = $3
    `, [idempotencyKey, new Date(), matchId]);
    
    console.log(`✅ IDEMPOTENCY: Marked match ${matchId} as processed with key: ${idempotencyKey}`);
  } catch (error) {
    console.error('❌ IDEMPOTENCY: Error marking as processed:', error);
  }
};

// Enhanced cleanup function for memory management
const cleanupInactiveGames = () => {
  const now = Date.now();
  const inactiveTimeout = 10 * 60 * 1000; // 10 minutes for truly inactive games
  const lockTimeout = 30 * 1000; // 30 seconds for matchmaking locks
  
  let cleanedGames = 0;
  let cleanedLocks = 0;
  
  // Clean up inactive games
  for (const [matchId, gameState] of activeGames.entries()) {
    const timeSinceActivity = now - gameState.lastActivity;
    
    // Only clean up games that are truly inactive (not completed)
    if (!gameState.completed && timeSinceActivity > inactiveTimeout) {
      console.log(`🧹 Cleaning up inactive game: ${matchId}`);
      
      // Clear any existing timeout
      if (gameState.cleanupTimeout) {
        clearTimeout(gameState.cleanupTimeout);
      }
      
      activeGames.delete(matchId);
      cleanedGames++;
    }
  }
  
  // Clean up stale matchmaking locks
  for (const [lockKey, lockData] of matchmakingLocks.entries()) {
    const timeSinceLock = now - lockData.timestamp;
    
    if (timeSinceLock > lockTimeout) {
      console.log(`🧹 Cleaning up stale matchmaking lock: ${lockKey}`);
      matchmakingLocks.delete(lockKey);
      cleanedLocks++;
    }
  }
  
  // Clean up in-memory matches older than 1 hour
  let cleanedInMemory = 0;
  for (const [matchId, matchData] of inMemoryMatches.entries()) {
    const timeSinceCreation = now - matchData.createdAt;
    if (timeSinceCreation > 60 * 60 * 1000) { // 1 hour
      inMemoryMatches.delete(matchId);
      cleanedInMemory++;
    }
  }
  
  // Update memory stats
  memoryStats = {
    activeGames: activeGames.size,
    matchmakingLocks: matchmakingLocks.size,
    inMemoryMatches: inMemoryMatches.size,
    lastCleanup: now
  };
  
  if (cleanedGames > 0 || cleanedLocks > 0 || cleanedInMemory > 0) {
    console.log(`🧹 Memory cleanup completed:`, {
      games: cleanedGames,
      locks: cleanedLocks,
      inMemory: cleanedInMemory,
      stats: memoryStats
    });
  }
  
  // Log memory usage if high
  if (memoryStats.activeGames > 100 || memoryStats.matchmakingLocks > 50) {
    console.warn(`⚠️ High memory usage detected:`, memoryStats);
  }
};

// Update game activity
const updateGameActivity = (matchId: string) => {
  const gameState = activeGames.get(matchId);
  if (gameState) {
    gameState.lastActivity = Date.now();
  }
};

// Mark game as completed and cleanup immediately
const markGameCompleted = (matchId: string) => {
  const gameState = activeGames.get(matchId);
  if (gameState) {
    gameState.completed = true;
    gameState.lastActivity = Date.now();
    console.log(`✅ Game ${matchId} marked as completed`);
    // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
    activeGames.delete(matchId);
    console.log(`🧹 Immediate cleanup: Removed completed game ${matchId} from memory`);
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
        
        // Remove completed match after 1 minute
        setTimeout(async () => {
          try {
            await matchRepository.remove(match);
            console.log(`🧹 Removed completed match ${matchId} from database`);
          } catch (error) {
            console.error(`❌ Error removing completed match ${matchId}:`, error);
          }
        }, 60000); // 1 minute delay
      }
    } catch (error) {
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
    
    // Clean up completed matches older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oldCompletedMatches = await matchRepository.find({
      where: { 
        status: 'completed',
        updatedAt: LessThan(oneHourAgo)
      }
    });
    
    if (oldCompletedMatches.length > 0) {
      console.log(`🧹 Cleaning up ${oldCompletedMatches.length} old completed matches`);
      await matchRepository.remove(oldCompletedMatches);
      console.log(`✅ Cleaned up ${oldCompletedMatches.length} old completed matches`);
    }
    
    // Log memory statistics
    console.log('📊 Memory statistics:', memoryStats);
    
    // Alert if memory usage is high
    if (memoryStats.activeGames > 50) {
      console.warn(`⚠️ High active games count: ${memoryStats.activeGames}`);
    }
    
    if (memoryStats.matchmakingLocks > 20) {
      console.warn(`⚠️ High matchmaking locks count: ${memoryStats.matchmakingLocks}`);
    }
    
    console.log('✅ Periodic cleanup completed');
    
  } catch (error) {
    console.error('❌ Error in periodic cleanup:', error);
  }
};

// Run periodic cleanup every 5 minutes
setInterval(periodicCleanup, 5 * 60 * 1000);

// Word list for games
const wordList = [
  'APPLE', 'BEACH', 'CHAIR', 'DREAM', 'EARTH', 'FLAME', 'GRAPE', 'HEART',
  'IMAGE', 'JUICE', 'KNIFE', 'LEMON', 'MUSIC', 'NIGHT', 'OCEAN', 'PEACE',
  'QUEEN', 'RADIO', 'SMILE', 'TABLE', 'UNITY', 'VOICE', 'WATER', 'YOUTH',
  'ZEBRA', 'ALPHA', 'BRAVE', 'CLOUD', 'DANCE', 'EAGLE', 'FAITH', 'GLORY',
  'HAPPY', 'IDEAL', 'JOYCE', 'KARMA', 'LIGHT', 'MAGIC', 'NOVEL', 'OPERA',
  'PRIDE', 'QUIET', 'RADAR', 'SPACE', 'TRUTH', 'UNITY', 'VALUE', 'WORLD'
];

const requestMatchHandler = async (req, res) => {
  try {
    console.log('📥 Received match request:', {
      body: req.body,
      headers: req.headers,
      method: req.method,
      url: req.url
    });

    // Check memory limits before processing
    const memoryStats = checkMemoryLimits();
    if (memoryStats.activeGames >= MAX_ACTIVE_GAMES) {
      console.warn('🚨 Server at capacity - rejecting match request');
      return res.status(503).json({ error: 'Server at capacity, please try again later' });
    }

    const wallet = req.body.wallet;
    const entryFee = Number(req.body.entryFee);
    
    console.log('🔍 Parsed data:', { wallet, entryFee, originalEntryFee: req.body.entryFee });
    console.log('🔍 Request body type:', typeof req.body);
    console.log('🔍 Request body keys:', Object.keys(req.body || {}));
    
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

    console.log(`✅ Player ${wallet} waiting for match with ${entryFee} SOL entry fee`);

    // CRITICAL: Implement locking to prevent race conditions
    const lockKey = `matchmaking_${wallet}`;
    if (matchmakingLocks.has(lockKey)) {
      console.log('⏳ Player already in matchmaking, returning existing lock');
      return res.status(429).json({ error: 'Matchmaking in progress, please wait' });
    }

    // Create lock for this player with enhanced tracking
    const matchmakingPromise = (async () => {
      try {
        return await performMatchmaking(wallet, entryFee);
      } finally {
        // Always clean up the lock
        matchmakingLocks.delete(lockKey);
      }
    })();

    matchmakingLocks.set(lockKey, {
      promise: matchmakingPromise,
      timestamp: Date.now(),
      wallet: wallet,
      entryFee: entryFee
    });
    
    const result = await matchmakingPromise;
    console.log(`✅ Matchmaking completed for ${wallet}:`, result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error in requestMatchHandler:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Clean up any locks that might have been created
    if (req.body.wallet) {
      const lockKey = `matchmaking_${req.body.wallet}`;
      if (matchmakingLocks.has(lockKey)) {
        matchmakingLocks.delete(lockKey);
      }
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Separate function for the actual matchmaking logic
const performMatchmaking = async (wallet: string, entryFee: number) => {
  try {
    console.log(`🔒 ATOMIC: Starting matchmaking for wallet: ${wallet} with entry fee: ${entryFee}`);
    
    // Get database repository
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up old matches for this player
    await cleanupOldMatches(matchRepository, wallet);
    
    // Check for existing active matches
    const existingMatch = await checkExistingMatches(matchRepository, wallet);
    if (existingMatch) {
      return existingMatch;
    }
    
    // Generate idempotency key for this matchmaking request
    const idempotencyKey = generateIdempotencyKey(wallet, 'matchmaking');
    
    // Check for duplicate requests
    const idempotencyCheck = await checkIdempotency(matchRepository, idempotencyKey);
    if (idempotencyCheck.isDuplicate) {
      console.log(`🔄 IDEMPOTENCY: Returning existing match for duplicate request`);
      return {
        status: 'matched',
        matchId: idempotencyCheck.existingMatch.id,
        player1: idempotencyCheck.existingMatch.player1,
        player2: idempotencyCheck.existingMatch.player2,
        entryFee: idempotencyCheck.existingMatch.entryFee,
        message: 'Match already created from previous request'
      };
    }
    
    // ATOMIC: Try to find and claim waiting player
    const claimedMatch = await findAndClaimWaitingPlayer(matchRepository, wallet, entryFee);
    
    if (claimedMatch) {
      console.log(`✅ ATOMIC: Successfully claimed waiting player and created match`);
      
      // Mark as processed with idempotency key
      await markIdempotencyProcessed(matchRepository, claimedMatch.matchId, idempotencyKey);
      
      return {
        status: 'matched',
        matchId: claimedMatch.matchId,
        player1: claimedMatch.player1,
        player2: claimedMatch.player2,
        entryFee: claimedMatch.entryFee,
        message: 'Match created - both players must pay entry fee to start game'
      };
    } else {
      console.log(`⏳ ATOMIC: No waiting players, creating waiting entry...`);
      
      // Create waiting entry with idempotency key
      const waitingResult = await createWaitingEntry(matchRepository, wallet, entryFee);
      
      // Mark waiting entry with idempotency key
      if (waitingResult.matchId) {
        await markIdempotencyProcessed(matchRepository, waitingResult.matchId, idempotencyKey);
      }
      
      return waitingResult;
    }
    
  } catch (error) {
    console.error('❌ Error in performMatchmaking:', error);
    // Clean up any locks that might have been created
    const lockKey = `matchmaking_${wallet}`;
    if (matchmakingLocks.has(lockKey)) {
      matchmakingLocks.delete(lockKey);
    }
    throw error;
  }
};

// Helper function to cleanup old matches for a player
const cleanupOldMatches = async (matchRepository: any, wallet: string) => {
  console.log(`🧹 Cleaning up old matches for wallet: ${wallet}`);
  
  // Use raw SQL to avoid TypeORM column issues - only select existing columns
  const oldPlayerMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "player1Paid",
      "player2Paid"
    FROM "match" 
    WHERE (("player1" = $1 AND "status" != $2) OR ("player2" = $3 AND "status" != $4))
  `, [wallet, 'escrow', wallet, 'escrow']);
  
  if (oldPlayerMatches.length > 0) {
    console.log(`🧹 Found ${oldPlayerMatches.length} old matches for ${wallet}, processing refunds and removing them`);
    
    // Process refunds for any matches where players paid but match failed
    for (const match of oldPlayerMatches) {
      if ((match.player1Paid || match.player2Paid) && match.status !== 'completed') {
        await processAutomatedRefunds(match, 'cleanup');
      }
    }
    
    // Remove old matches using raw SQL
    await matchRepository.query(`
      DELETE FROM "match" 
      WHERE (("player1" = $1 AND "status" != $2) OR ("player2" = $3 AND "status" != $4))
    `, [wallet, 'escrow', wallet, 'escrow']);
    
    console.log(`✅ Cleaned up ${oldPlayerMatches.length} old matches for ${wallet}`);
  } else {
    console.log(`✅ No old matches found for ${wallet}`);
  }
  
  // Also cleanup any stale waiting entries older than 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const staleWaitingMatches = await matchRepository.query(`
    SELECT id FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['waiting', fiveMinutesAgo]);
  
  if (staleWaitingMatches.length > 0) {
    console.log(`🧹 Found ${staleWaitingMatches.length} stale waiting matches, removing them`);
    await matchRepository.query(`
      DELETE FROM "match" 
      WHERE "status" = $1 AND "createdAt" < $2
    `, ['waiting', fiveMinutesAgo]);
    console.log(`✅ Cleaned up ${staleWaitingMatches.length} stale waiting matches`);
  }
  
  // Cleanup any completed matches older than 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oldCompletedMatches = await matchRepository.query(`
    SELECT id FROM "match" 
    WHERE "status" = $1 AND "updatedAt" < $2
  `, ['completed', oneHourAgo]);
  
  if (oldCompletedMatches.length > 0) {
    console.log(`🧹 Found ${oldCompletedMatches.length} old completed matches, removing them`);
    await matchRepository.query(`
      DELETE FROM "match" 
      WHERE "status" = $1 AND "updatedAt" < $2
    `, ['completed', oneHourAgo]);
    console.log(`✅ Cleaned up ${oldCompletedMatches.length} old completed matches`);
  }
};

// Helper function to check for existing matches and cleanup if needed
const checkExistingMatches = async (matchRepository: any, wallet: string) => {
  // First, cleanup any old matches for this player
  await cleanupOldMatches(matchRepository, wallet);
  
  // Now check if there are any remaining active matches using raw SQL
  const existingMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      "entryFee",
      "escrowAddress",
      status
    FROM "match" 
    WHERE (("player1" = $1 AND "status" IN ($2, $3)) OR ("player2" = $4 AND "status" IN ($5, $6)))
    LIMIT 1
  `, [wallet, 'active', 'escrow', wallet, 'active', 'escrow']);
  
  if (existingMatches.length > 0) {
    const existingMatch = existingMatches[0];
    console.log('⚠️ Player still has an active/escrow match after cleanup');
    return {
      status: 'matched',
      matchId: existingMatch.id,
      player1: existingMatch.player1,
      player2: existingMatch.player2,
      entryFee: existingMatch.entryFee,
      escrowAddress: existingMatch.escrowAddress,
      matchStatus: existingMatch.status,
      message: existingMatch.status === 'escrow' ? 'Match created - please lock your entry fee' : 'Already in active match'
    };
  }
  
  return null;
};

// Helper function to find waiting players with simplified logic
const findWaitingPlayer = async (matchRepository: any, wallet: string, entryFee: number) => {
  const tolerance = 0.001;
  const minEntryFee = entryFee - tolerance;
  const maxEntryFee = entryFee + tolerance;
  
  try {
    console.log(`🔍 Looking for waiting players for ${wallet} with entry fee: ${entryFee} SOL`);
    
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
      
      console.log(`🔍 Trying flexible matching (10% tolerance):`);
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
      console.log(`🔍 Trying any waiting player (for testing):`);
      
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
      
      console.log(`🎯 Found waiting player: ${waitingEntry.player1} for ${wallet}`);
      
      // Create a NEW match record (not update the waiting entry)
      const actualEntryFee = Math.min(waitingEntry.entryFee, entryFee);
      
      // Generate game word
      const { getRandomWord } = require('../wordList');
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
    
  } catch (error) {
    console.error('❌ Error in findWaitingPlayer:', error);
    throw error;
  }
};

// ATOMIC MATCHMAKING: Find and claim waiting player in single transaction
const findAndClaimWaitingPlayer = async (matchRepository: any, wallet: string, entryFee: number) => {
  const tolerance = 0.001;
  const minEntryFee = entryFee - tolerance;
  const maxEntryFee = entryFee + tolerance;
  
  try {
    console.log(`🔒 ATOMIC: Looking for waiting players for ${wallet} with entry fee: ${entryFee} SOL`);
    
    // Use database transaction to ensure atomicity
    const result = await matchRepository.manager.transaction(async (manager) => {
      // Find waiting player with row-level lock (FIFO order)
      const waitingMatch = await manager.query(`
        SELECT 
          id,
          "player1",
          "entryFee",
          "createdAt"
        FROM "match" 
        WHERE "status" = $1 
          AND "entryFee" BETWEEN $2 AND $3 
          AND "player2" IS NULL 
          AND "player1" != $4
        ORDER BY "createdAt" ASC 
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `, ['waiting', minEntryFee, maxEntryFee, wallet]);
      
      if (waitingMatch.length === 0) {
        console.log(`❌ ATOMIC: No waiting players found for ${wallet}`);
        return null;
      }
      
      const waitingPlayer = waitingMatch[0];
      console.log(`🔒 ATOMIC: Found waiting player:`, {
        matchId: waitingPlayer.id,
        player: waitingPlayer.player1,
        entryFee: waitingPlayer.entryFee,
        createdAt: waitingPlayer.createdAt
      });
      
      // Generate game word
      const { getRandomWord } = require('../wordList');
      const gameWord = getRandomWord();
      
      // Update the match atomically within transaction
      const actualEntryFee = Math.min(waitingPlayer.entryFee, entryFee);
      
      await manager.query(`
        UPDATE "match" 
        SET 
          "player2" = $1,
          "entryFee" = $2,
          "status" = $3,
          "word" = $4,
          "player1Paid" = $5,
          "player2Paid" = $6,
          "updatedAt" = $7
        WHERE id = $8
      `, [
        wallet, 
        actualEntryFee, 
        'payment_required', 
        gameWord,
        false, 
        false, 
        new Date(),
        waitingPlayer.id
      ]);
      
      console.log(`✅ ATOMIC: Successfully claimed waiting player and created match`);
      
      return {
        matchId: waitingPlayer.id,
        player1: waitingPlayer.player1,
        player2: wallet,
        entryFee: actualEntryFee,
        status: 'payment_required',
        word: gameWord
      };
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ ATOMIC: Error in findAndClaimWaitingPlayer:', error);
    throw error;
  }
};

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
      status: 'matched',
      matchId: waitingPlayer.matchId,
      player1: waitingPlayer.wallet,
      player2: wallet,
      entryFee: waitingPlayer.entryFee,
      message: 'Match created - both players must pay entry fee to start game'
    };
  } catch (error) {
    console.error('❌ Error in createMatch:', error);
    throw error;
  }
};

// Helper function to create a waiting entry
const createWaitingEntry = async (matchRepository: any, wallet: string, entryFee: number) => {
  try {
    // Clean up any old waiting entries for this player first using raw SQL
    const oldWaitingEntries = await matchRepository.query(`
      SELECT id FROM "match" 
      WHERE "player1" = $1 AND "status" = $2 AND "player2" IS NULL
    `, [wallet, 'waiting']);
    
    if (oldWaitingEntries.length > 0) {
      console.log(`🧹 Cleaning up ${oldWaitingEntries.length} old waiting entries for ${wallet}`);
      await matchRepository.query(`
        DELETE FROM "match" 
        WHERE "player1" = $1 AND "status" = $2 AND "player2" IS NULL
      `, [wallet, 'waiting']);
    }
    
    // Create new waiting entry using raw SQL
    const result = await matchRepository.query(`
      INSERT INTO "match" ("player1", "player2", "entryFee", "status", "word", "player1Paid", "player2Paid", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, "player1", "entryFee", "status", "createdAt"
    `, [wallet, null, entryFee, 'waiting', null, false, false, new Date(), new Date()]);
    
    const savedMatch = result[0];
    console.log(`✅ New waiting entry created with ID: ${savedMatch.id} for wallet: ${wallet}`);
    console.log(`📊 Waiting entry details:`, {
      id: savedMatch.id,
      player1: savedMatch.player1,
      entryFee: savedMatch.entryFee,
      status: savedMatch.status,
      createdAt: savedMatch.createdAt
    });
    
    return {
      status: 'waiting',
      message: 'Waiting for opponent',
      waitingCount: 0,
      matchId: savedMatch.id
    };
  } catch (error) {
    console.error('❌ Error creating waiting entry:', error);
    throw error;
  }
};

// Debug endpoint to check waiting players
const debugWaitingPlayersHandler = async (req, res) => {
  try {
    console.log('🔍 Debug: Checking waiting players...');
    
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
    } catch (dbError) {
      console.warn('⚠️ Database queries failed:', dbError.message);
    }
    
    // Get in-memory matches
    const memoryActiveMatches = [];
    
    // Check active games in memory
    for (const [matchId, gameState] of activeGames.entries()) {
      memoryActiveMatches.push({
        id: matchId,
        player1: 'active_game',
        player2: 'active_game',
        entryFee: 0,
        status: 'active',
        source: 'memory'
      });
    }
    
    const totalWaiting = dbWaitingMatches.length;
    const totalActive = dbActiveMatches.length + memoryActiveMatches.length;
    
    console.log('🔍 Debug results:', {
      database: { waiting: dbWaitingMatches.length, active: dbActiveMatches.length },
      memory: { waiting: 0, active: memoryActiveMatches.length },
      total: { waiting: totalWaiting, active: totalActive }
    });
    
    res.json({
      database: {
        waitingCount: dbWaitingMatches.length,
        activeCount: dbActiveMatches.length,
        waitingPlayers: dbWaitingMatches.map(m => ({
          id: m.id,
          player1: m.player1,
          entryFee: m.entryFee,
          createdAt: m.createdAt,
          source: 'database'
        })),
        activeMatches: dbActiveMatches.map(m => ({
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
  } catch (error) {
    console.error('❌ Error in debugWaitingPlayersHandler:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Simple test endpoint
const matchTestHandler = async (req, res) => {
  try {
    console.log('🧪 Test endpoint called');
    res.json({ 
      status: 'ok', 
      message: 'Test endpoint working',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: 'Test endpoint failed' });
  }
};

// Simple test endpoint for repository debugging
const testRepositoryHandler = async (req, res) => {
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
    } catch (repoError) {
      console.error('❌ Repository creation failed:', repoError);
      res.status(500).json({ 
        error: 'Repository creation failed',
        details: {
          message: repoError.message,
          name: repoError.name,
          stack: repoError.stack
        }
      });
    }
  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: 'Test endpoint failed' });
  }
};

// Simple database test endpoint
const testDatabaseHandler = async (req, res) => {
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
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    res.status(500).json({ 
      error: 'Database test failed',
      details: {
        message: error.message,
        name: error.name,
        stack: error.stack
      }
    });
  }
};

// Cleanup self-matches endpoint
const cleanupSelfMatchesHandler = async (req, res) => {
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
    const selfMatches = activeMatches.filter(match => match.player1 === match.player2);
    
    if (selfMatches.length > 0) {
      console.log(`🧹 Found ${selfMatches.length} self-matches to clean up:`, selfMatches.map(m => m.id));
      await matchRepository.remove(selfMatches);
      console.log('✅ Self-matches cleaned up successfully');
    } else {
      console.log('✅ No self-matches found');
    }
    
    res.json({
      success: true,
      message: 'Self-matches cleaned up',
      removedCount: selfMatches.length,
      removedMatches: selfMatches.map(m => ({ id: m.id, player1: m.player1, player2: m.player2 }))
    });
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Helper function to determine winner and calculate payout instructions
const determineWinnerAndPayout = async (matchId, player1Result, player2Result) => {
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
        const tolerance = 0.001; // 1 millisecond tolerance for "exact" ties
        
        if (timeDiff < tolerance) {
          // Times are effectively identical - both pay fee
          winner = 'tie';
          console.log('⚖️ Exact time tie detected - both pay fee');
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
    const winnerAmount = entryFee * 0.95; // 95% of pot
    const feeAmount = entryFee * 0.05; // 5% fee

    payoutResult = {
      winner: winnerWallet,
      winnerAmount: winnerAmount,
      feeAmount: feeAmount,
      feeWallet: FEE_WALLET_ADDRESS,
      transactions: [
        {
          from: loserWallet,
          to: winnerWallet,
          amount: winnerAmount,
          description: 'Winner payout'
        },
        {
          from: loserWallet,
          to: FEE_WALLET_ADDRESS,
          amount: feeAmount,
          description: 'Platform fee'
        }
      ]
    };

    console.log('💰 Payout calculated:', payoutResult);
  } else if (winner === 'tie') {
    // Determine if this is a winning tie (both solved) or losing tie (both failed)
    const isWinningTie = player1Result && player2Result && player1Result.won && player2Result.won;
    
    if (isWinningTie) {
      // Winning tie: Both solved same moves + same time - no payments
      console.log('🤝 Winning tie: Both solved same moves + same time - no payments');
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: 0,
        feeWallet: FEE_WALLET_ADDRESS,
        transactions: [
          {
            from: match.player1,
            to: match.player1,
            amount: match.entryFee,
            description: 'Winning tie refund'
          },
          {
            from: match.player2,
            to: match.player2,
            amount: match.entryFee,
            description: 'Winning tie refund'
          }
        ]
      };
    } else {
      // Losing tie: Both failed to solve - fee wallet keeps 5% from each player
      console.log('🤝 Losing tie: Both failed to solve - fee wallet keeps 5% from each player');
      const feeAmount = match.entryFee * 0.05;
      const refundAmount = match.entryFee * 0.95; // 95% refund to each player
      
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: feeAmount * 2, // Total fees from both players
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
  match.payoutResult = payoutResult;
  match.isCompleted = true;
  await matchRepository.save(match);

  return payoutResult;
};

const submitResultHandler = async (req, res) => {
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

    // SERVER-SIDE VALIDATION: Get server-side game state
    const serverGameState = activeGames.get(matchId);
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
    if (isPlayer1 && match.player1Result) {
      return res.status(400).json({ error: 'Player 1 already submitted result' });
    }
    if (!isPlayer1 && match.player2Result) {
      return res.status(400).json({ error: 'Player 2 already submitted result' });
    }

    // SERVER-SIDE VALIDATION: Validate guesses against server state
    const serverGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    if (result.guesses.length !== serverGuesses.length) {
      return res.status(400).json({ error: 'Guess count mismatch with server state' });
    }

    // SERVER-SIDE VALIDATION: Validate each guess
    for (let i = 0; i < result.guesses.length; i++) {
      if (result.guesses[i] !== serverGuesses[i]) {
        return res.status(400).json({ error: 'Guess mismatch with server state' });
      }
    }

    // SERVER-SIDE VALIDATION: Validate win condition
    const expectedWon = serverGameState.word === result.guesses[result.guesses.length - 1];
    if (result.won !== expectedWon) {
      return res.status(400).json({ error: 'Win condition mismatch with server state' });
    }

    // SERVER-SIDE VALIDATION: Use server-side time tracking
    const serverStartTime = isPlayer1 ? serverGameState.player1StartTime : serverGameState.player2StartTime;
    const serverEndTime = Date.now();
    const serverTotalTime = serverEndTime - serverStartTime;

    // SERVER-SIDE VALIDATION: Validate time limits
    if (serverTotalTime > 120000) { // 2 minutes
      return res.status(400).json({ error: 'Game time exceeded 2-minute limit' });
    }

    // SERVER-SIDE VALIDATION: Check for impossibly fast times (less than 1 second)
    if (serverTotalTime < 1000) {
      return res.status(400).json({ error: 'Suspiciously fast completion time detected' });
    }

    console.log('📝 Submitting SERVER-VALIDATED result for match:', matchId);
    console.log('Wallet:', wallet);
    console.log('Server-validated result:', {
      won: result.won,
      numGuesses: result.numGuesses,
      totalTime: serverTotalTime,
      guesses: result.guesses
    });

    // Create server-validated result object
    const serverValidatedResult = {
      won: result.won,
      numGuesses: result.numGuesses,
      totalTime: serverTotalTime, // Use server time, not client time
      guesses: result.guesses,
      reason: 'server-validated'
    };

    // Update server game state
    if (isPlayer1) {
      serverGameState.player1Solved = result.won;
    } else {
      serverGameState.player2Solved = result.won;
    }

    // Save result to database
    if (isPlayer1) {
      match.player1Result = serverValidatedResult;
    } else {
      match.player2Result = serverValidatedResult;
    }

    console.log(`📝 ${isPlayer1 ? 'Player 1' : 'Player 2'} SERVER-VALIDATED result recorded`);

    // Check if this player solved the puzzle
    if (result.won) {
      console.log(`🏆 ${isPlayer1 ? 'Player 1' : 'Player 2'} solved the puzzle!`);
      
      // If the other player already submitted a result, determine winner immediately
      if ((isPlayer1 && match.player2Result) || (!isPlayer1 && match.player1Result)) {
        console.log('🏁 Both players have results, determining winner immediately...');
        
        // Save this player's result first
        await matchRepository.save(match);
        
        // Get the latest match data with both results
        const updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
        
        const payoutResult = await determineWinnerAndPayout(matchId, updatedMatch.player1Result, updatedMatch.player2Result);
        
        // Execute automated payment if there's a clear winner
        // Calculate direct payment instructions
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          console.log('💰 Calculating automated payout...');
          
          const winner = payoutResult.winner;
          const loser = winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1;
          const entryFee = updatedMatch.entryFee;
          
          // Calculate payment amounts
          const winnerAmount = entryFee * 0.95; // 95% to winner
          const feeAmount = entryFee * 0.05; // 5% fee
          
          // Try to execute automated payout if private key is available
          try {
            const { getFeeWalletKeypair } = require('../config/wallet');
            const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
            
            const feeWalletKeypair = getFeeWalletKeypair();
            const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
            
            // Create payout transaction
            const payoutTransaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: feeWalletKeypair.publicKey,
                toPubkey: new PublicKey(winner),
                lamports: Math.floor(winnerAmount * LAMPORTS_PER_SOL)
              })
            );
            
            // Get recent blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            payoutTransaction.recentBlockhash = blockhash;
            payoutTransaction.feePayer = feeWalletKeypair.publicKey;
            
            // Sign and send transaction
            const signature = await connection.sendTransaction(payoutTransaction, [feeWalletKeypair]);
            await connection.confirmTransaction(signature);
            
            console.log('✅ Automated payout successful:', signature);
            
            // Create payment instructions for display
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              automatedPayout: true,
              payoutSignature: signature,
              transactions: [
                {
                  from: FEE_WALLET_ADDRESS,
                  to: winner,
                  amount: winnerAmount,
                  description: 'Automated payout to winner',
                  signature: signature
                }
              ]
            };
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = true;
            payoutResult.automatedPayout = true;
            
            console.log('✅ Automated payout completed');
            
          } catch (error) {
            console.warn('⚠️ Automated payout failed, falling back to manual instructions:', error.message);
            
            // Fallback to manual payment instructions
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              automatedPayout: false,
              transactions: [
                {
                  from: FEE_WALLET_ADDRESS,
                  to: winner,
                  amount: winnerAmount,
                  description: 'Manual payout to winner (contact support)'
                }
              ]
            };
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = false;
            payoutResult.paymentError = 'Automated payout failed - contact support';
            
            console.log('⚠️ Manual payment instructions created');
          }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.player1Result && updatedMatch.player2Result && 
              updatedMatch.player1Result.won && updatedMatch.player2Result.won) {
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
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = true;
            
            console.log('✅ Tie payment instructions created');
          } else {
            // Losing tie - each pays fee
            console.log('🤝 Losing tie - each player pays fee...');
            
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
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 2'
                }
              ]
            };
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = true;
            
            console.log('✅ Losing tie payment instructions created');
          }
        }
        
        // Mark match as completed
        updatedMatch.isCompleted = true;
        updatedMatch.payoutResult = payoutResult;
        await matchRepository.save(updatedMatch);
        
        // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
        markGameCompleted(matchId);
        
        res.json({
          status: 'completed',
          winner: payoutResult.winner,
          payout: payoutResult,
          message: 'Game completed - winner determined'
        });
      } else {
        // Save partial result and wait for other player
        await matchRepository.save(match);
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player to finish'
        });
      }
    } else {
      // Player didn't solve - check if other player solved
      if ((isPlayer1 && match.player2Result && match.player2Result.won) || 
          (!isPlayer1 && match.player1Result && match.player1Result.won)) {
        console.log('🏁 Other player already solved, determining winner...');
        
        // Save this player's result first
        await matchRepository.save(match);
        
        // Get the latest match data with both results
        const updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
        
        const payoutResult = await determineWinnerAndPayout(matchId, updatedMatch.player1Result, updatedMatch.player2Result);
        
        // Execute automated payment
        // Calculate direct payment instructions
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          console.log('💰 Calculating automated payout...');
          
          const winner = payoutResult.winner;
          const loser = winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1;
          const entryFee = updatedMatch.entryFee;
          
          // Calculate payment amounts
          const winnerAmount = entryFee * 0.95; // 95% to winner
          const feeAmount = entryFee * 0.05; // 5% fee
          
          // Try to execute automated payout if private key is available
          try {
            const { getFeeWalletKeypair } = require('../config/wallet');
            const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
            
            const feeWalletKeypair = getFeeWalletKeypair();
            const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
            
            // Create payout transaction
            const payoutTransaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: feeWalletKeypair.publicKey,
                toPubkey: new PublicKey(winner),
                lamports: Math.floor(winnerAmount * LAMPORTS_PER_SOL)
              })
            );
            
            // Get recent blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            payoutTransaction.recentBlockhash = blockhash;
            payoutTransaction.feePayer = feeWalletKeypair.publicKey;
            
            // Sign and send transaction
            const signature = await connection.sendTransaction(payoutTransaction, [feeWalletKeypair]);
            await connection.confirmTransaction(signature);
            
            console.log('✅ Automated payout successful:', signature);
            
            // Create payment instructions for display
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              automatedPayout: true,
              payoutSignature: signature,
              transactions: [
                {
                  from: FEE_WALLET_ADDRESS,
                  to: winner,
                  amount: winnerAmount,
                  description: 'Automated payout to winner',
                  signature: signature
                }
              ]
            };
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = true;
            payoutResult.automatedPayout = true;
            
            console.log('✅ Automated payout completed');
            
          } catch (error) {
            console.warn('⚠️ Automated payout failed, falling back to manual instructions:', error.message);
            
            // Fallback to manual payment instructions
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              automatedPayout: false,
              transactions: [
                {
                  from: FEE_WALLET_ADDRESS,
                  to: winner,
                  amount: winnerAmount,
                  description: 'Manual payout to winner (contact support)'
                }
              ]
            };
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = false;
            payoutResult.paymentError = 'Automated payout failed - contact support';
            
            console.log('⚠️ Manual payment instructions created');
          }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.player1Result && updatedMatch.player2Result && 
              updatedMatch.player1Result.won && updatedMatch.player2Result.won) {
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
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = true;
            
            console.log('✅ Tie payment instructions created');
          } else {
            // Losing tie - each pays fee
            console.log('🤝 Losing tie - each player pays fee...');
            
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
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 2'
                }
              ]
            };
            
            payoutResult.paymentInstructions = paymentInstructions;
            payoutResult.paymentSuccess = true;
            
            console.log('✅ Losing tie payment instructions created');
          }
        }
        
        // Mark match as completed
        updatedMatch.isCompleted = true;
        updatedMatch.payoutResult = payoutResult;
        await matchRepository.save(updatedMatch);
        
        // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
        markGameCompleted(matchId);
        
        res.json({
          status: 'completed',
          winner: payoutResult.winner,
          payout: payoutResult,
          message: 'Game completed - winner determined'
        });
      } else {
        // Save partial result and wait for other player
        await matchRepository.save(match);
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player to finish'
        });
      }
    }

  } catch (error) {
    console.error('❌ Error submitting result:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getMatchStatusHandler = async (req, res) => {
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
        console.log('✅ Match found in database');
      }
    } catch (dbError) {
      console.warn('⚠️ Database lookup failed:', dbError.message);
    }
    
    // If not found in database, check in-memory matches
    if (!match) {
      console.log('🔍 Checking in-memory matches...');
      match = inMemoryMatches.get(matchId);
      if (match) {
        console.log('✅ Match found in memory');
      } else {
        console.log('❌ Match not found in database or memory');
        return res.status(404).json({ error: 'Match not found' });
      }
    }

    // Check if this match already has results for the requesting player
    const requestingWallet = req.query.wallet || req.headers['x-wallet'];
    const isPlayer1 = match.player1 === requestingWallet;
    const existingResult = isPlayer1 ? match.player1Result : match.player2Result;
    
    console.log('✅ Returning match data:', {
      status: match.status,
      player1: match.player1,
      player2: match.player2,
      hasWord: !!match.word,
      requestingWallet,
      hasExistingResult: !!existingResult
    });

    // If match has existing results, mark it as completed
    if (existingResult) {
      match.status = 'completed';
      match.isCompleted = true;
    }

  res.json({
    status: match.status,
      player1: match.player1,
      player2: match.player2,
      word: match.word,
      player1Result: match.player1Result,
      player2Result: match.player2Result,
      winner: match.winner,
      payout: match.payoutResult,
      isCompleted: match.isCompleted || !!existingResult
    });

  } catch (error) {
    console.error('❌ Error getting match status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Check if a player has been matched (for polling)
const checkPlayerMatchHandler = async (req, res) => {
  try {
    const { wallet } = req.params;
    
    console.log('🔍 Checking if player has been matched:', wallet);
    
    if (!wallet) {
      console.log('❌ No wallet provided in request');
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    const { AppDataSource } = require('../db/index');
    
    // Check if database is connected
    if (!AppDataSource.isInitialized) {
      console.error('❌ Database not initialized');
      return res.status(500).json({ error: 'Database connection error' });
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
          "escrowAddress",
          "entryFee"
        FROM "match" 
        WHERE (("player1" = $1 OR "player2" = $2) AND "status" IN ($3, $4, $5, $6, $7))
        LIMIT 1
      `, [wallet, wallet, 'active', 'escrow', 'matched', 'payment_required']);

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
      `, [wallet, wallet, 'cancelled']);
      
      console.log('✅ Database queries completed successfully');
    } catch (dbError) {
      console.error('❌ Database query error:', dbError);
      console.error('❌ Error details:', {
        message: dbError.message,
        stack: dbError.stack,
        code: dbError.code
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
      
      console.log('🔍 All matches for player:', allPlayerMatches.map(m => ({
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
        escrowAddress: activeMatch.escrowAddress,
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
        console.log('🎯 Found available waiting match for player to join:', {
          waitingEntryId: availableWaitingMatch.id,
          waitingPlayer: availableWaitingMatch.player1,
          entryFee: availableWaitingMatch.entryFee,
          requestingPlayer: wallet
        });
        
        // Create a new match (don't update the waiting entry)
        const actualEntryFee = Math.min(availableWaitingMatch.entryFee, 0.1039); // Use the entry fee from the request
        
        // Generate game word
        const { getRandomWord } = require('../wordList');
        const gameWord = getRandomWord();
        
        // Create new match record
        let newMatchResult = [];
        try {
          newMatchResult = await matchRepository.query(`
            INSERT INTO "match" (
              "player1", "player2", "entryFee", "status", "word", 
              "player1Paid", "player2Paid", "createdAt", "updatedAt"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, "player1", "player2", "entryFee", "status"
          `, [
            availableWaitingMatch.player1, wallet, actualEntryFee, 'payment_required', gameWord,
            false, false, new Date(), new Date()
          ]);
          
          const newMatch = newMatchResult[0];
          
          // Delete the waiting entry since we've created a match
          try {
            await matchRepository.query(`
              DELETE FROM "match" 
              WHERE id = $1
            `, [availableWaitingMatch.id]);
          } catch (deleteError) {
            console.error('❌ Error deleting waiting entry:', deleteError);
            // Continue even if deletion fails
          }
          
          console.log('✅ Successfully created match and removed waiting entry');
          
          res.json({
            matched: true,
            matchId: newMatch.id,
            status: 'payment_required',
            player1: newMatch.player1,
            player2: wallet,
            player1Paid: false,
            player2Paid: false,
            entryFee: newMatch.entryFee,
            message: 'Match created - please pay your entry fee'
          });
          return;
        } catch (createError) {
          console.error('❌ Error creating match:', createError);
          // Continue to check for waiting matches
        }
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
      
      res.json({ matched: false });
    }
    
  } catch (error) {
    console.error('❌ Error checking player match:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Confirm escrow payment and activate game
const confirmEscrowHandler = async (req, res) => {
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
    
  } catch (error) {
    console.error('❌ Error confirming escrow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Server-side game guess tracking endpoint
const submitGameGuessHandler = async (req, res) => {
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

    // Get server-side game state
    const serverGameState = activeGames.get(matchId as string);
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

  } catch (error) {
    console.error('❌ Error submitting guess:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Add server-side game state endpoint
const getGameStateHandler = async (req, res) => {
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

    // Get server-side game state
    const serverGameState = activeGames.get(matchId as string);
    if (!serverGameState) {
      console.log(`❌ Game state not found for match ${matchId}`);
      console.log(`🔍 Active games:`, Array.from(activeGames.keys()));
      console.log(`🔍 Match status:`, match?.status);
      
      // If match is active but no game state, try to reinitialize
      if (match?.status === 'active') {
        console.log(`🔄 Attempting to reinitialize game state for match ${matchId}`);
        const word = require('../wordList').getRandomWord();
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
        activeGames.set(matchId as string, newGameState);
        console.log(`✅ Reinitialized game state for match ${matchId}`);
        
        // Use the new game state
        const reinitializedGameState = activeGames.get(matchId as string);
        if (reinitializedGameState) {
          const isPlayer1 = wallet === match.player1;
          const playerGuesses = isPlayer1 ? reinitializedGameState.player1Guesses : reinitializedGameState.player2Guesses;
          
          return res.json({
            success: true,
            playerGuesses,
            totalGuesses: playerGuesses.length,
            remainingGuesses: 7 - playerGuesses.length,
            solved: isPlayer1 ? reinitializedGameState.player1Solved : reinitializedGameState.player2Solved,
            opponentSolved: isPlayer1 ? reinitializedGameState.player2Solved : reinitializedGameState.player1Solved,
            gameActive: !reinitializedGameState.player1Solved && !reinitializedGameState.player2Solved,
            targetWord: reinitializedGameState.word // Include target word for color calculation
          });
        }
      }
      
      return res.status(404).json({ error: 'Game not found or already completed' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    const opponentGuesses = isPlayer1 ? serverGameState.player2Guesses : serverGameState.player1Guesses;

    // Return safe game state (don't reveal the word or opponent's guesses)
    res.json({
      success: true,
      playerGuesses,
      totalGuesses: playerGuesses.length,
      remainingGuesses: 7 - playerGuesses.length,
      solved: isPlayer1 ? serverGameState.player1Solved : serverGameState.player2Solved,
      opponentSolved: isPlayer1 ? serverGameState.player2Solved : serverGameState.player1Solved,
      gameActive: !serverGameState.player1Solved && !serverGameState.player2Solved,
      targetWord: serverGameState.word // Include target word for color calculation
    });

  } catch (error) {
    console.error('❌ Error getting game state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Server-side payment execution endpoint
const executePaymentHandler = async (req, res) => {
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
    if (!match.payoutResult) {
      return res.status(400).json({ error: 'No payout result available' });
    }

    console.log('💰 Executing server-side payment:', {
      matchId,
      wallet,
      paymentType,
      payoutResult: match.payoutResult
    });

    let paymentResult;
    
    // Direct payment approach - no server-side payment execution
    // Players handle their own payments through the frontend
    res.json({
      success: true,
      message: 'Direct payment approach - use frontend to send payments',
      paymentInstructions: match.payoutResult?.paymentInstructions || null
    });

  } catch (error) {
    console.error('❌ Error executing payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create escrow transaction endpoint
const createEscrowTransactionHandler = async (req, res) => {
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
    
  } catch (error) {
    console.error('❌ Error creating escrow transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const cleanupStuckMatchesHandler = async (req, res) => {
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
  } catch (error) {
    console.error('❌ Error cleaning up stuck matches:', error);
    res.status(500).json({ error: 'Failed to cleanup matches' });
  }
};

// Simple cleanup endpoint for production
const simpleCleanupHandler = async (req, res) => {
  try {
    console.log('🧹 Running simple cleanup...');
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up all old matches
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Clean up old completed matches
    const completedMatches = await matchRepository.find({
      where: { status: 'completed' }
    });
    
    // Clean up old waiting matches
    const waitingMatches = await matchRepository.find({
      where: { status: 'waiting' }
    });
    
    // Clean up old escrow matches
    const escrowMatches = await matchRepository.find({
      where: { status: 'escrow' }
    });
    
    let cleanedCount = 0;
    
    if (completedMatches.length > 0) {
      await matchRepository.remove(completedMatches);
      cleanedCount += completedMatches.length;
      console.log(`🧹 Cleaned up ${completedMatches.length} completed matches`);
    }
    
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
    
    // Clean up old payment_required matches and process refunds
    const paymentRequiredMatches = await matchRepository.find({
      where: { status: 'payment_required' }
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
    const activeGamesSize = activeGames.size;
    activeGames.clear();
    matchmakingLocks.clear();
    
    console.log(`🧹 Cleaned up ${cleanedCount} database matches and ${activeGamesSize} in-memory games`);
    
    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} database matches and ${activeGamesSize} in-memory games`,
      cleanedDatabase: cleanedCount,
      cleanedMemory: activeGamesSize
    });
    
  } catch (error) {
    console.error('❌ Simple cleanup failed:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cleanup matches',
      details: error.message 
    });
  }
};

// New endpoint to force cleanup for a specific wallet (for testing)
const forceCleanupForWallet = async (req, res) => {
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
  } catch (error) {
    console.error('❌ Error in force cleanup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to force cleanup matches'
    });
  }
};

// Process refunds for failed matches
const processRefundsForFailedMatch = async (match) => {
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
    const entryFeeLamports = Math.floor(match.entryFee * LAMPORTS_PER_SOL);
    
    // Calculate refund amount (entry fee minus network fee)
    const networkFeeLamports = Math.floor(0.0001 * LAMPORTS_PER_SOL); // 0.0001 SOL network fee
    const refundLamports = entryFeeLamports - networkFeeLamports;
    
    console.log(`💰 Refund calculation: ${match.entryFee} SOL - 0.0001 SOL = ${refundLamports / LAMPORTS_PER_SOL} SOL`);
    
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
      } catch (error) {
        console.error(`❌ Failed to refund Player 1: ${error.message}`);
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
      } catch (error) {
        console.error(`❌ Failed to refund Player 2: ${error.message}`);
      }
    }
    
    console.log(`✅ All refunds processed for match ${match.id} (0.0001 SOL fee deducted per refund)`);
    
  } catch (error) {
    console.error('❌ Error processing refunds:', error);
  }
};

// Automated refund system - handles all refund scenarios
const processAutomatedRefunds = async (match, reason = 'unknown') => {
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
    
    match.status = 'cancelled';
    match.refundReason = reason;
    match.refundedAt = new Date();
    
    await matchRepository.save(match);
    
    console.log(`✅ Automated refunds completed for match ${match.id}`);
    
  } catch (error) {
    console.error(`❌ Error in automated refunds for match ${match.id}:`, error);
  }
};

// Payment confirmation endpoint
const confirmPaymentHandler = async (req, res) => {
  try {
    console.log('📥 Received confirm payment request:', {
      body: req.body,
      headers: req.headers,
      method: req.method,
      url: req.url
    });

    const { matchId, wallet, paymentSignature } = req.body;
    
    console.log('🔍 Parsed confirm payment data:', { matchId, wallet, paymentSignature });
    
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

    // Validate player is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerKey = isPlayer1 ? 'player1' : 'player2';

    // Check if already paid
    if (isPlayer1 && match.player1Paid) {
      return res.status(400).json({ error: 'Player 1 already paid' });
    }
    if (!isPlayer1 && match.player2Paid) {
      return res.status(400).json({ error: 'Player 2 already paid' });
    }

    // Enhanced transaction verification using Phase 2 service
    const verificationResult = await paymentVerificationService.verifyPayment(
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

    // Mark player as paid
    if (isPlayer1) {
      match.player1Paid = true;
      match.player1PaymentSignature = paymentSignature;
      console.log(`✅ Marked Player 1 (${wallet}) as paid for match ${matchId}`);
    } else {
      match.player2Paid = true;
      match.player2PaymentSignature = paymentSignature;
      console.log(`✅ Marked Player 2 (${wallet}) as paid for match ${matchId}`);
    }

    // Update payment tracking
    match.paymentAttempts = (match.paymentAttempts || 0) + 1;
    match.lastPaymentAttempt = new Date();
    match.paymentVerificationSignature = paymentSignature;

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

    // Check if both players have paid
    if (match.player1Paid && match.player2Paid) {
      console.log(`🎮 Both players have paid for match ${matchId}, starting game IMMEDIATELY...`);
      console.log(`💰 Payment details:`, {
        matchId,
        player1: match.player1,
        player2: match.player2,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        entryFee: match.entryFee
      });
      
      // Use state machine to transition to active
      const transitionSuccess = await matchStateMachine.transition(match, 'active' as any, {
        action: 'payment_complete',
        wallet,
        verificationResult
      });

      if (!transitionSuccess) {
        console.error('❌ State transition failed for match:', matchId);
        return res.status(500).json({ error: 'Failed to activate game' });
      }
      
      // Initialize server-side game state with the SAME word for both players
      const word = match.word || require('../wordList').getRandomWord();
      activeGames.set(matchId, {
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
      });

      console.log(`🎮 Game started for match ${matchId} with word: ${word}`);
      console.log(`🎮 Active games count: ${activeGames.size}`);
      console.log(`🎮 Game state initialized:`, {
        matchId,
        word,
        player1: match.player1,
        player2: match.player2,
        startTime: Date.now()
      });
      
      // IMMEDIATELY save to database so both players can see the status change
      await matchRepository.save(match);
      console.log(`✅ Match ${matchId} status saved as 'active' - both players will be redirected`);
      
      // Send WebSocket event for game started
      websocketService.broadcastToMatch(matchId, {
        type: WebSocketEventType.GAME_STARTED,
        matchId,
        data: {
          player1: match.player1,
          player2: match.player2,
          entryFee: match.entryFee,
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
            activeGames.delete(matchId);
            matchmakingLocks.delete(matchId);
            
            console.log(`✅ Match ${matchId} cancelled due to payment timeout`);
          }
        } catch (error) {
          console.error('❌ Error handling payment timeout:', error);
        }
      }, 60000); // 1 minute timeout
      
      // Store the timeout reference in memory (since database might not have this field)
      if (!match.timeoutId) {
        match.timeoutId = paymentTimeout;
      }
      
      // Also store in memory for cleanup
      if (!matchmakingLocks.has(matchId)) {
        matchmakingLocks.set(matchId, {
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

  } catch (error) {
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
const websocketStatsHandler = async (req, res) => {
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
  } catch (error) {
    enhancedLogger.error('❌ WebSocket stats failed:', error);
    res.status(500).json({ error: 'Failed to get WebSocket stats' });
  }
};

// Enhanced payment verification function with idempotency
const verifyPaymentTransaction = async (signature: string, fromWallet: string, expectedAmount: number) => {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');
    
    console.log('🔍 ENHANCED: Verifying payment transaction:', {
      signature,
      fromWallet,
      expectedAmount,
      network: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
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
    const feeWalletIndex = accountKeys.findIndex(key => key.equals(feeWalletPublicKey));
    const fromWalletIndex = accountKeys.findIndex(key => key.equals(fromWalletPublicKey));
    
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
    
  } catch (error) {
    console.error('❌ ENHANCED: Payment verification error:', error);
    return {
      verified: false,
      error: `Verification failed: ${error.message}`
    };
  }
};

// Debug matches endpoint
const debugMatchesHandler = async (req, res) => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get all matches
    const allMatches = await matchRepository.find({
      order: { createdAt: 'DESC' },
      take: 20
    });
    
    // Get active games
    const activeGamesList = Array.from(activeGames.entries()).map(([matchId, gameState]) => ({
      matchId,
      word: gameState.word,
      player1Solved: gameState.player1Solved,
      player2Solved: gameState.player2Solved,
      startTime: gameState.startTime
    }));
    
    res.json({
      timestamp: new Date().toISOString(),
      totalMatches: allMatches.length,
      activeGames: activeGamesList,
      matches: allMatches.map(match => ({
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
    
  } catch (error) {
    console.error('❌ Error in debug matches:', error);
    res.status(500).json({ error: 'Debug failed' });
  }
};

// Memory monitoring endpoint
const memoryStatsHandler = async (req, res) => {
  try {
    const { AppDataSource } = require('../db/index');
    
    // Get database stats
    const matchRepository = AppDataSource.getRepository(Match);
    const totalMatches = await matchRepository.count();
    const waitingMatches = await matchRepository.count({ where: { status: 'waiting' } });
    const activeMatches = await matchRepository.count({ where: { status: 'active' } });
    const completedMatches = await matchRepository.count({ where: { status: 'completed' } });
    
    res.json({
      timestamp: new Date().toISOString(),
      memory: memoryStats,
      database: {
        totalMatches,
        waitingMatches,
        activeMatches,
        completedMatches
      },
      warnings: []
    });
    
  } catch (error) {
    console.error('❌ Memory stats failed:', error);
    res.status(500).json({ error: 'Failed to get memory stats' });
  }
};

// Debug endpoint to check matchmaking state
const debugMatchmakingHandler = async (req, res) => {
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
    const hasLock = matchmakingLocks.has(lockKey);
    const lockData = hasLock ? matchmakingLocks.get(lockKey) : null;
    
    res.json({
      wallet,
      timestamp: new Date().toISOString(),
      allMatches: allMatches.map(m => ({
        id: m.id,
        status: m.status,
        player1: m.player1,
        player2: m.player2,
        entryFee: m.entryFee,
        createdAt: m.createdAt,
        player1Paid: m.player1Paid,
        player2Paid: m.player2Paid
      })),
      waitingMatches: waitingMatches.map(m => ({
        id: m.id,
        player1: m.player1,
        entryFee: m.entryFee,
        createdAt: m.createdAt
      })),
      matchmakingLock: {
        hasLock,
        lockData: hasLock ? {
          timestamp: lockData.timestamp,
          wallet: lockData.wallet,
          entryFee: lockData.entryFee,
          age: Date.now() - lockData.timestamp
        } : null
      },
      memoryStats
    });
    
  } catch (error) {
    console.error('❌ Debug matchmaking failed:', error);
    res.status(500).json({ error: 'Failed to get debug info' });
  }
};

// Manual refund endpoint for testing
const manualRefundHandler = async (req, res) => {
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
    
  } catch (error) {
    console.error('❌ Error in manual refund:', error);
    res.status(500).json({ error: 'Failed to process manual refund' });
  }
};

// Manual match endpoint to fix stuck matchmaking
const manualMatchHandler = async (req, res) => {
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
      status: 'matched',
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
      status: 'matched'
    });
    
  } catch (error) {
    console.error('❌ Error in manual match:', error);
    res.status(500).json({ error: 'Failed to create manual match' });
  }
};

// Database migration endpoint (for adding new columns)
const runMigrationHandler = async (req, res) => {
  try {
    console.log('🔄 Running database migration...');
    
    const { AppDataSource } = require('../db/index');
    
    // Run the migration SQL directly
    const migrationQueries = [
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
      } catch (error) {
        console.log(`⚠️ Column might already exist: ${error.message}`);
      }
    }
    
    console.log('✅ Database migration completed successfully');
    
    res.json({
      success: true,
      message: 'Database migration completed successfully',
      columnsAdded: [
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
    
  } catch (error) {
    console.error('❌ Error running migration:', error);
    res.status(500).json({ error: 'Failed to run migration' });
  }
};

// Helper function to convert UTC to EST
const convertToEST = (date) => {
  if (!date) return '';
  const utcDate = new Date(date);
  const estDate = new Date(utcDate.toLocaleString("en-US", {timeZone: "America/New_York"}));
  return estDate.toISOString().replace('T', ' ').substring(0, 19);
};

// Helper function to get SOL price in USD
const getSolPriceUSD = async () => {
  try {
    // Using CoinGecko API for SOL price
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    return data.solana.usd;
  } catch (error) {
    console.error('❌ Error fetching SOL price:', error);
    return null;
  }
};

// Helper function to get transaction details from blockchain
const getTransactionDetails = async (signature) => {
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
    const network = process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet';
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
  } catch (error) {
    console.error(`❌ Error fetching transaction ${signature}:`, error);
    return null;
  }
};

// Helper function to verify and update match with blockchain data
const updateMatchWithBlockchainData = async (match) => {
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
    
  } catch (error) {
    console.error('❌ Error updating match with blockchain data:', error);
    return null;
  }
};

// Helper function to calculate fiscal year and quarter
const getFiscalInfo = (date) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { fiscalYear: year, quarter };
};

// Match report endpoint (exports to CSV)
const generateReportHandler = async (req, res) => {
  try {
    const { startDate = '2025-08-16', endDate } = req.query;
    
    console.log('📊 Generating match report...');
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Build date filter
    let dateFilter = `DATE("createdAt") >= '${startDate}'`;
    if (endDate) {
      dateFilter += ` AND DATE("createdAt") <= '${endDate}'`;
    }
    
    // Get all matches with only columns that definitely exist in database
    const matches = await matchRepository.query(`
      SELECT 
        id,
        "player1",
        "player2",
        "entryFee",
        status,
        word,
        "escrowAddress",
        "gameStartTime",
        "player1EscrowConfirmed",
        "player2EscrowConfirmed",
        "player1EscrowSignature",
        "player2EscrowSignature",
        "player1Paid",
        "player2Paid",
        "player1Result",
        "player2Result",
        winner,
        "payoutResult",
        "player1PaymentSignature",
        "player2PaymentSignature",
        "winnerPayoutSignature",
        "player1RefundSignature",
        "player2RefundSignature",
        "matchOutcome",
        "gameEndTime",
        "matchDuration",
        "totalFeesCollected",
        "platformFee",
        "refundReason",
        "refundedAt",
        "isCompleted",
        "createdAt",
        "updatedAt"
      FROM "match" 
      WHERE ${dateFilter}
      ORDER BY "createdAt" DESC
    `);
    
    console.log(`📊 Found ${matches.length} matches for report`);
    
    // Generate CSV headers - basic match data (columns that exist)
    const csvHeaders = [
      'Match ID',
      'Player 1 Wallet',
      'Player 2 Wallet', 
      'Entry Fee (SOL)',
      'Match Status',
      'Player 1 Paid',
      'Player 2 Paid',
      'Match Outcome',
      'Total Match Duration (sec)',
      'Total Fees Collected (SOL)',
      'Platform Fee (SOL)',
      'Game End Time (EST)',
      'Match Created (EST)',
      'Last Updated (EST)',
      '🔗 BLOCKCHAIN VERIFICATION DATA 🔗',
      'Player 1 Payment TX (Click to Verify)',
      'Player 2 Payment TX (Click to Verify)',
      'Winner Payout TX (Click to Verify)',
      'Player 1 Refund TX (Click to Verify)',
      'Player 2 Refund TX (Click to Verify)',
      '🔗 BLOCKCHAIN EXPLORER LINKS 🔗',
      'Player 1 Payment Explorer Link',
      'Player 2 Payment Explorer Link',
      'Winner Payout Explorer Link',
      'Player 1 Refund Explorer Link',
      'Player 2 Refund Explorer Link',
      '🔗 BASIC GAME DATA 🔗',
      'Target Word',
      'Player 1 Result (JSON)',
      'Player 2 Result (JSON)',
      'Refund Reason',
      'Refunded At (EST)',
      'Winner'
    ];
    
    // Generate CSV rows - basic match data (columns that exist)
    const csvRows = matches.map(match => [
      match.id,
      match.player1,
      match.player2,
      match.entryFee,
      match.status,
      match.player1Paid || false,
      match.player2Paid || false,
      match.matchOutcome || '',
      match.matchDuration || '',
      match.totalFeesCollected || (match.entryFee * 2) || '',
      match.platformFee || '',
      convertToEST(match.gameEndTime),
      convertToEST(match.createdAt),
      convertToEST(match.updatedAt),
      '', // 🔗 BLOCKCHAIN VERIFICATION DATA 🔗
      match.player1PaymentSignature || '',
      match.player2PaymentSignature || '',
      match.winnerPayoutSignature || '',
      match.player1RefundSignature || '',
      match.player2RefundSignature || '',
      '', // 🔗 BLOCKCHAIN EXPLORER LINKS 🔗
      match.player1PaymentSignature ? `https://explorer.solana.com/tx/${match.player1PaymentSignature}?cluster=${process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet'}` : '',
      match.player2PaymentSignature ? `https://explorer.solana.com/tx/${match.player2PaymentSignature}?cluster=${process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet'}` : '',
      match.winnerPayoutSignature ? `https://explorer.solana.com/tx/${match.winnerPayoutSignature}?cluster=${process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet'}` : '',
      match.player1RefundSignature ? `https://explorer.solana.com/tx/${match.player1RefundSignature}?cluster=${process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet'}` : '',
      match.player2RefundSignature ? `https://explorer.solana.com/tx/${match.player2RefundSignature}?cluster=${process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet'}` : '',
      '', // 🔗 BASIC GAME DATA 🔗
      match.word || '', // Use word field which exists
      JSON.stringify(match.player1Result || {}),
      JSON.stringify(match.player2Result || {}),
      match.refundReason || '',
      convertToEST(match.refundedAt),
      match.winner || ''
    ]);
    
    // Combine headers and rows
    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(field => `"${field || ''}"`).join(','))
      .join('\n');
    
    // Set response headers for CSV download
    const filename = `guess5_matches_${startDate}${endDate ? '_to_' + endDate : ''}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    console.log(`✅ Report generated: ${filename} with ${matches.length} matches`);
    
    res.send(csvContent);
    
  } catch (error) {
    console.error('❌ Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

// Blockchain verification endpoint
const verifyBlockchainDataHandler = async (req, res) => {
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
    
  } catch (error) {
    console.error('❌ Error verifying blockchain data:', error);
    res.status(500).json({ error: 'Failed to verify blockchain data' });
  }
};

// Server-Sent Events endpoint for real-time wallet balance updates
const walletBalanceSSEHandler = async (req, res) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    console.log('🔌 SSE connection requested for wallet:', wallet);
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
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
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');
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
    } catch (error) {
      console.error('❌ Error fetching initial balance:', error);
      const errorMessage = {
        type: 'error',
        wallet: wallet,
        message: 'Failed to fetch initial balance',
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
    }
    
    // Set up periodic balance checks (every 10 seconds)
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
      } catch (error) {
        console.error('❌ Error fetching balance update:', error);
        const errorMessage = {
          type: 'error',
          wallet: wallet,
          message: 'Failed to fetch balance update',
          timestamp: new Date().toISOString()
        };
        res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
      }
    }, 10000); // Check every 10 seconds
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('🔌 SSE connection closed for wallet:', wallet);
      clearInterval(balanceInterval);
    });
    
    // Handle server shutdown
    req.on('error', (error) => {
      console.error('❌ SSE connection error:', error);
      clearInterval(balanceInterval);
    });
    
  } catch (error) {
    console.error('❌ Error in wallet balance SSE handler:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
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

module.exports = {
  requestMatchHandler,
  submitResultHandler,
  getMatchStatusHandler,
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
  runMigrationHandler,
  generateReportHandler,
  verifyBlockchainDataHandler,
  processAutomatedRefunds,
  walletBalanceSSEHandler,
  verifyPaymentTransaction,
  generateIdempotencyKey,
  checkIdempotency,
  markIdempotencyProcessed,
  findAndClaimWaitingPlayer,
  websocketStatsHandler,
}; 
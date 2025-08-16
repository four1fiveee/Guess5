const expressMatch = require('express');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');
const { Not, LessThan, Between } = require('typeorm');
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
    console.log(`🔍 Starting matchmaking for wallet: ${wallet} with entry fee: ${entryFee}`);
    
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
    
    // Look for waiting players with improved error handling
    const waitingPlayer = await findWaitingPlayer(matchRepository, wallet, entryFee);
    
    if (waitingPlayer) {
      console.log(`🎯 Found waiting player, creating match...`);
      return await createMatch(matchRepository, waitingPlayer, wallet, entryFee);
    } else {
      console.log(`⏳ No waiting players, creating waiting entry...`);
      return await createWaitingEntry(matchRepository, wallet, entryFee);
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
  
  // Find all matches for this player (EXCEPT escrow status - those are active matches)
  const oldPlayerMatches = await matchRepository.find({
    where: [
      { player1: wallet, status: Not('escrow') },
      { player2: wallet, status: Not('escrow') }
    ]
  });
  
  if (oldPlayerMatches.length > 0) {
    console.log(`🧹 Found ${oldPlayerMatches.length} old matches for ${wallet}, removing them`);
    await matchRepository.remove(oldPlayerMatches);
    console.log(`✅ Cleaned up ${oldPlayerMatches.length} old matches for ${wallet}`);
  } else {
    console.log(`✅ No old matches found for ${wallet}`);
  }
  
  // Also cleanup any stale waiting entries older than 5 minutes
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
  
  // Cleanup any completed matches older than 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oldCompletedMatches = await matchRepository.find({
    where: {
      status: 'completed',
      updatedAt: LessThan(oneHourAgo)
    }
  });
  
  if (oldCompletedMatches.length > 0) {
    console.log(`🧹 Found ${oldCompletedMatches.length} old completed matches, removing them`);
    await matchRepository.remove(oldCompletedMatches);
    console.log(`✅ Cleaned up ${oldCompletedMatches.length} old completed matches`);
  }
};

// Helper function to check for existing matches and cleanup if needed
const checkExistingMatches = async (matchRepository: any, wallet: string) => {
  // First, cleanup any old matches for this player
  await cleanupOldMatches(matchRepository, wallet);
  
  // Now check if there are any remaining active matches
  const existingMatch = await matchRepository.findOne({
    where: [
      { player1: wallet, status: 'active' },
      { player2: wallet, status: 'active' },
      { player1: wallet, status: 'escrow' },
      { player2: wallet, status: 'escrow' }
    ]
  });
  
  if (existingMatch) {
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

// Helper function to find waiting players with race condition prevention
const findWaitingPlayer = async (matchRepository: any, wallet: string, entryFee: number) => {
  const tolerance = 0.001;
  const minEntryFee = entryFee - tolerance;
  const maxEntryFee = entryFee + tolerance;
  
  // Use database transaction to prevent race conditions
  const { AppDataSource } = require('../db/index');
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  
  try {
    console.log(`🔍 Trying strict matching for ${wallet} with transaction lock:`);
    console.log(`  Entry fee: ${entryFee} SOL`);
    console.log(`  Strict range: ${minEntryFee} - ${maxEntryFee} SOL`);
    
    // Use pessimistic locking to prevent race conditions
    let waitingMatches = await queryRunner.manager.find(Match, {
      where: {
        status: 'waiting',
        entryFee: Between(minEntryFee, maxEntryFee),
        player2: null,
        player1: Not(wallet)
      },
      order: { createdAt: 'ASC' },
      take: 1,
      lock: { mode: 'pessimistic_write' } // Lock the rows to prevent race conditions
    });
    
    console.log(`  Found ${waitingMatches.length} waiting matches with strict tolerance`);
    
    // If no exact match, try with more flexible fee matching (within 5% tolerance for better matching)
    if (waitingMatches.length === 0) {
      const flexibleMinEntryFee = entryFee * 0.95;
      const flexibleMaxEntryFee = entryFee * 1.05;
      
      console.log(`🔍 Trying flexible matching for ${wallet}:`);
      console.log(`  Entry fee: ${entryFee} SOL`);
      console.log(`  Flexible range: ${flexibleMinEntryFee} - ${flexibleMaxEntryFee} SOL`);
      
      waitingMatches = await queryRunner.manager.find(Match, {
        where: {
          status: 'waiting',
          entryFee: Between(flexibleMinEntryFee, flexibleMaxEntryFee),
          player2: null,
          player1: Not(wallet)
        },
        order: { createdAt: 'ASC' },
        take: 1,
        lock: { mode: 'pessimistic_write' } // Lock the rows to prevent race conditions
      });
      
      console.log(`  Found ${waitingMatches.length} waiting matches with flexible tolerance`);
    }
    
    if (waitingMatches.length > 0) {
      const match = waitingMatches[0];
      
      // Double-check the match is still valid
      if (match.player2 === null && match.status === 'waiting' && match.player1 !== wallet) {
        console.log(`🎯 Found waiting player: ${match.player1} for ${wallet}`);
        
        // Immediately update the waiting player's status to prevent double-matching
        match.status = 'matched';
        match.player2 = wallet; // Set the second player immediately
        await queryRunner.manager.save(Match, match);
        
        await queryRunner.commitTransaction();
        console.log(`✅ Successfully locked waiting player ${match.player1} for matching`);
        
        return {
          wallet: match.player1,
          entryFee: match.entryFee,
          matchId: match.id
        };
      } else {
        console.log(`⚠️ Match ${match.id} is no longer valid for ${wallet}`);
      }
    }
    
    await queryRunner.commitTransaction();
    console.log(`❌ No waiting players found for ${wallet} with entry fee ${entryFee}`);
    return null;
    
  } catch (error) {
    console.error('❌ Error in findWaitingPlayer transaction:', error);
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
};

// Helper function to create a match
const createMatch = async (matchRepository: any, waitingPlayer: any, wallet: string, entryFee: number) => {
  try {
    const actualEntryFee = Math.min(waitingPlayer.entryFee, entryFee);
    
    console.log('🎮 Creating match between players:', {
      player1: waitingPlayer.wallet,
      player2: wallet,
      actualEntryFee: actualEntryFee
    });
    
    // Update the waiting match with better error handling
    const existingMatch = await matchRepository.findOne({ where: { id: waitingPlayer.matchId } });
    if (!existingMatch) {
      throw new Error('Waiting match not found - may have been claimed by another player');
    }
    
    // Verify the match is still in the correct state
    if (existingMatch.status !== 'matched' || existingMatch.player2 !== wallet) {
      throw new Error('Match state has changed - another player may have claimed this match');
    }
    
    // Generate game word
    const { getRandomWord } = require('../wordList');
    const gameWord = getRandomWord();
    
    // Update match details
    existingMatch.status = 'payment_required'; // Require upfront payments
    existingMatch.word = gameWord;
    existingMatch.entryFee = actualEntryFee;
    existingMatch.player1Paid = false;
    existingMatch.player2Paid = false;
    existingMatch.createdAt = new Date(); // Update timestamp
    
    const updatedMatch = await matchRepository.save(existingMatch);
    
    console.log('✅ Match created successfully:', {
      matchId: updatedMatch.id,
      status: updatedMatch.status,
      entryFee: updatedMatch.entryFee
    });
    
    return {
      status: 'matched',
      matchId: updatedMatch.id,
      player1: updatedMatch.player1,
      player2: updatedMatch.player2,
      entryFee: updatedMatch.entryFee,
      message: 'Match created - both players must pay entry fee to start game'
    };
  } catch (error) {
    console.error('❌ Error creating match:', error);
    throw error;
  }
};

// Helper function to create a waiting entry
const createWaitingEntry = async (matchRepository: any, wallet: string, entryFee: number) => {
  try {
    // Check if player already has a waiting entry
    const existingWaitingEntry = await matchRepository.findOne({
      where: {
        player1: wallet,
        status: 'waiting',
        player2: null
      }
    });
    
    if (existingWaitingEntry) {
      console.log('⚠️ Player already has waiting entry:', existingWaitingEntry.id);
      return {
        status: 'waiting',
        message: 'Already waiting for opponent',
        waitingCount: 0
      };
    }
    
    // Create new waiting entry
    const waitingMatch = matchRepository.create({
      player1: wallet,
      player2: null,
      entryFee: entryFee,
      status: 'waiting',
      word: null,
      player1Paid: false,
      player2Paid: false
    });
    
    const savedMatch = await matchRepository.save(waitingMatch);
    console.log(`✅ New waiting entry saved with ID: ${savedMatch.id} for wallet: ${wallet}`);
    
    return {
      status: 'waiting',
      message: 'Waiting for opponent',
      waitingCount: 0
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
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Check for active matches with this player (including payment_required status)
    const activeMatch = await matchRepository.findOne({
      where: [
        { player1: wallet, status: 'active' },
        { player2: wallet, status: 'active' },
        { player1: wallet, status: 'escrow' },
        { player2: wallet, status: 'escrow' },
        { player1: wallet, status: 'matched' },
        { player2: wallet, status: 'matched' },
        { player1: wallet, status: 'payment_required' },
        { player2: wallet, status: 'payment_required' }
      ]
    });

    // Also check for cancelled matches
    const cancelledMatch = await matchRepository.findOne({
      where: [
        { player1: wallet, status: 'cancelled' },
        { player2: wallet, status: 'cancelled' }
      ]
    });
    
    if (activeMatch) {
      console.log('✅ Player has been matched:', {
        matchId: activeMatch.id,
        player1: activeMatch.player1,
        player2: activeMatch.player2,
        status: activeMatch.status,
        requestingWallet: wallet
      });
      
      // Also log all matches for this player for debugging
      const allPlayerMatches = await matchRepository.find({
        where: [
          { player1: wallet },
          { player2: wallet }
        ]
      });
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
        word: activeMatch.word,
        escrowAddress: activeMatch.escrowAddress,
        entryFee: activeMatch.entryFee,
        message: message
      });
    } else if (cancelledMatch) {
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
      
      // Also check for waiting matches to debug
      const waitingMatch = await matchRepository.findOne({
        where: {
          player1: wallet,
          status: 'waiting',
          player2: null
        }
      });
      
      if (waitingMatch) {
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
    const opponentGuesses = isPlayer1 ? serverGameState.player2Guesses : serverGameState.player1Guesses;

    // Return safe game state (don't reveal the word or opponent's guesses)
    res.json({
      success: true,
      playerGuesses,
      totalGuesses: playerGuesses.length,
      remainingGuesses: 7 - playerGuesses.length,
      solved: isPlayer1 ? serverGameState.player1Solved : serverGameState.player2Solved,
      opponentSolved: isPlayer1 ? serverGameState.player2Solved : serverGameState.player1Solved,
      gameActive: !serverGameState.player1Solved && !serverGameState.player2Solved
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

    // Verify transaction on Solana blockchain (simplified for testing)
    try {
      const { Connection, PublicKey } = require('@solana/web3.js');
      const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
      
      // Get transaction details
      const transaction = await connection.getTransaction(paymentSignature);
      if (!transaction) {
        console.warn('⚠️ Transaction not found on blockchain, but allowing for testing');
      } else if (transaction.meta?.err) {
        console.warn('⚠️ Transaction failed on blockchain, but allowing for testing');
      } else {
        console.log(`✅ Payment verified for ${isPlayer1 ? 'Player 1' : 'Player 2'}:`, {
          matchId,
          wallet,
          paymentSignature,
          expectedAmount: Math.floor(match.entryFee * 1000000000)
        });
      }

    } catch (error) {
      console.error('❌ Transaction verification failed:', error);
      console.warn('⚠️ Allowing payment despite verification failure (testing mode)');
    }

    // Mark player as paid
    if (isPlayer1) {
      match.player1Paid = true;
      console.log(`✅ Marked Player 1 (${wallet}) as paid for match ${matchId}`);
    } else {
      match.player2Paid = true;
      console.log(`✅ Marked Player 2 (${wallet}) as paid for match ${matchId}`);
    }

    console.log(`🔍 Payment status for match ${matchId}:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2,
      currentPlayer: wallet
    });

    // Check if both players have paid
    if (match.player1Paid && match.player2Paid) {
      console.log(`🎮 Both players have paid for match ${matchId}, starting game...`);
      match.status = 'active';
      
      // Initialize server-side game state
      const word = require('../wordList').getRandomWord();
      activeGames.set(matchId, {
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
      });

      console.log(`🎮 Game started for match ${matchId} with word: ${word}`);
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
            console.log(`⏰ Payment timeout for match ${matchId} - cancelling match`);
            
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

module.exports = {
  requestMatchHandler,
  submitResultHandler,
  getMatchStatusHandler,
  checkPlayerMatchHandler,
  debugWaitingPlayersHandler,
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
  memoryStatsHandler
}; 
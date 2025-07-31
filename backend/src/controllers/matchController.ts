const expressMatch = require('express');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');
const { Not, LessThan, Between } = require('typeorm');
const { createEscrowAccount, payout, refundEscrow } = require('../services/payoutService');

// In-memory storage for matches that couldn't be saved to database
const inMemoryMatches = new Map();

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

    const wallet = req.body.wallet;
    const entryFee = Number(req.body.entryFee);
    
    console.log('🔍 Parsed data:', { wallet, entryFee, originalEntryFee: req.body.entryFee });
    
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

    console.log(`✅ Player ${wallet} waiting for match with $${entryFee} entry fee`);

    // Database is required for cross-device matchmaking
    let matchRepository = null;
    
    // Check if database is initialized first with retry
    let dbInitialized = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!dbInitialized && retryCount < maxRetries) {
      try {
        const { AppDataSource } = require('../db/index');
        console.log(`🔍 Database initialization status (attempt ${retryCount + 1}):`, AppDataSource.isInitialized);
        
        if (AppDataSource.isInitialized) {
          dbInitialized = true;
          console.log('✅ Database is initialized');
        } else {
          console.log(`⏳ Database not ready yet, retrying in 1 second... (${retryCount + 1}/${maxRetries})`);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (dbError) {
        console.error('❌ Cannot check database status:', dbError);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    if (!dbInitialized) {
      console.error('❌ Database not initialized after retries');
      return res.status(503).json({ error: 'Database not ready - please try again' });
    }
    
    try {
      console.log('🔍 Attempting to get database repository...');
      const { AppDataSource } = require('../db/index');
      matchRepository = AppDataSource.getRepository(Match);
      console.log('✅ Database repository available');
    } catch (repoError) {
      console.error('❌ Database repository not available:', repoError);
      console.error('❌ Error details:', {
        message: repoError.message,
        stack: repoError.stack,
        name: repoError.name
      });
      return res.status(503).json({ error: 'Database not available - matchmaking unavailable' });
    }
    
    // Clean up old completed matches and self-matches (non-blocking)
    // Run cleanup every time to ensure stale matches don't interfere
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        // Clean up old completed matches
        const oldCompletedMatches = await matchRepository.find({
          where: {
            status: 'completed',
            updatedAt: LessThan(oneHourAgo)
          }
        });
        
        // Clean up self-matches (where player1 === player2)
        const selfMatches = await matchRepository.find({
          where: {
            status: 'active',
            player1: Not(null),
            player2: Not(null)
          }
        });
        
        const actualSelfMatches = selfMatches.filter(match => match.player1 === match.player2);
        
        // Clean up waiting self-matches
        const waitingSelfMatches = await matchRepository.find({
          where: {
            status: 'waiting',
            player1: wallet
          }
        });
        
        if (oldCompletedMatches.length > 0) {
          console.log(`🧹 Cleaning up ${oldCompletedMatches.length} old completed matches`);
          await matchRepository.remove(oldCompletedMatches);
        }
        
        if (actualSelfMatches.length > 0) {
          console.log(`🧹 Cleaning up ${actualSelfMatches.length} self-matches`);
          await matchRepository.remove(actualSelfMatches);
        }
        
        if (waitingSelfMatches.length > 0) {
          console.log(`🧹 Cleaning up ${waitingSelfMatches.length} waiting self-matches for current player`);
          await matchRepository.remove(waitingSelfMatches);
        }
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup old matches:', cleanupError.message);
      }
    
    // Use database transaction to prevent race conditions
    const { AppDataSource } = require('../db/index');
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    try {
      // Clean up any stale waiting entries for this player (older than 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const staleEntries = await queryRunner.manager.find(Match, {
        where: {
          player1: wallet,
          status: 'waiting',
          player2: null,
          createdAt: LessThan(fiveMinutesAgo)
        }
      });
      
      if (staleEntries.length > 0) {
        console.log(`🧹 Cleaning up ${staleEntries.length} stale waiting entries for player ${wallet}`);
        await queryRunner.manager.remove(staleEntries);
      }
      
      // Clean up old active matches (older than 10 minutes) that are likely stale
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const staleActiveMatches = await queryRunner.manager.find(Match, {
        where: [
          { player1: wallet, status: 'active', createdAt: LessThan(tenMinutesAgo) },
          { player2: wallet, status: 'active', createdAt: LessThan(tenMinutesAgo) },
          { player1: wallet, status: 'escrow', createdAt: LessThan(tenMinutesAgo) },
          { player2: wallet, status: 'escrow', createdAt: LessThan(tenMinutesAgo) }
        ]
      });
      
      if (staleActiveMatches.length > 0) {
        console.log(`🧹 Cleaning up ${staleActiveMatches.length} stale active/escrow matches for player ${wallet}`);
        await queryRunner.manager.remove(staleActiveMatches);
      }
      
      // Check for existing active/escrow matches for this player
      const existingActiveMatch = await queryRunner.manager.findOne(Match, {
        where: [
          { player1: wallet, status: 'active' },
          { player2: wallet, status: 'active' },
          { player1: wallet, status: 'escrow' },
          { player2: wallet, status: 'escrow' }
        ]
      });
      
      if (existingActiveMatch) {
        console.log('🔍 Found existing active/escrow match:', {
          id: existingActiveMatch.id,
          player1: existingActiveMatch.player1,
          player2: existingActiveMatch.player2,
          status: existingActiveMatch.status,
          entryFee: existingActiveMatch.entryFee,
          escrowAddress: existingActiveMatch.escrowAddress,
          createdAt: existingActiveMatch.createdAt,
          updatedAt: existingActiveMatch.updatedAt
        });
        
        // CRITICAL: If the existing match is a self-match, clean it up and return an error
        if (existingActiveMatch.player1 === existingActiveMatch.player2) {
          console.log('❌ Detected existing self-match, cleaning up and returning error to force retry.');
          await queryRunner.manager.remove(existingActiveMatch);
          await queryRunner.commitTransaction(); // Commit the cleanup
          return res.status(400).json({ error: 'Detected and cleaned up a self-match. Please try again.' });
        } else {
          // Check if the existing match is stale (older than 10 minutes)
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          if (existingActiveMatch.updatedAt < tenMinutesAgo) {
            console.log('🧹 Cleaning up stale active/escrow match:', existingActiveMatch.id);
            await queryRunner.manager.remove(existingActiveMatch);
            await queryRunner.commitTransaction();
            console.log('✅ Stale match cleaned up, allowing new matchmaking');
            // Continue with normal matchmaking flow
          } else {
            console.log('⚠️ Player already has an active/escrow match, returning match info');
            await queryRunner.rollbackTransaction();
            res.json({
              status: 'matched',
              matchId: existingActiveMatch.id,
              player1: existingActiveMatch.player1,
              player2: existingActiveMatch.player2,
              entryFee: existingActiveMatch.entryFee, // This should already be the lesser amount
              escrowAddress: existingActiveMatch.escrowAddress,
              message: existingActiveMatch.status === 'escrow' ? 'Match created - please lock your entry fee' : 'Already in active match'
            });
            return;
          }
        }
      }

      // Look for waiting players in database with transaction isolation
      let waitingPlayer = null;
      
      // Use tolerance-based matching to handle slight price differences
      const tolerance = 0.001; // Allow 0.001 SOL difference
      const minEntryFee = entryFee - tolerance;
      const maxEntryFee = entryFee + tolerance;
      
      console.log('🔍 Searching database for waiting players with entry fee:', entryFee);
      console.log('🔍 Entry fee type:', typeof entryFee);
      console.log('🔍 Entry fee value:', entryFee);
      console.log('🔍 Tolerance range:', `${minEntryFee} - ${maxEntryFee}`);
      
      // Find waiting matches with transaction isolation
      
      const waitingMatches = await queryRunner.manager.find(Match, {
        where: {
          status: 'waiting',
          entryFee: Between(minEntryFee, maxEntryFee),
          player2: null,
          player1: Not(wallet) // Exclude current player in query
        },
        order: {
          createdAt: 'ASC'
        },
        take: 1 // Only get the first match
      });
      
      console.log('🔍 Filtered waiting matches (excluding current player):', waitingMatches.map(m => ({
        id: m.id,
        player1: m.player1,
        player2: m.player2,
        entryFee: m.entryFee,
        createdAt: m.createdAt
      })));

      console.log(`🔍 Found ${waitingMatches.length} waiting matches in database`);
      console.log('🔍 Waiting matches:', waitingMatches);
      
      // Log how many players are waiting for this stake amount (excluding current player)
      const totalWaitingForStake = await queryRunner.manager.count(Match, {
        where: {
          status: 'waiting',
          entryFee: Between(minEntryFee, maxEntryFee),
          player2: null,
          player1: Not(wallet) // Exclude current player from count
        }
      });
      console.log(`📊 Total players waiting for $${entryFee} ±${tolerance} (excluding current player): ${totalWaitingForStake}`);
      
      if (waitingMatches.length > 0) {
        const match = waitingMatches[0];
        
        console.log('🔍 Found waiting match:', {
          id: match.id,
          player1: match.player1,
          player2: match.player2,
          status: match.status,
          entryFee: match.entryFee,
          createdAt: match.createdAt
        });
        
        // Double-check that this match is still actually waiting and not already matched
        if (match.player2 === null && match.status === 'waiting') {
          // Additional check: make sure this isn't the same player trying to match with themselves
          if (match.player1 === wallet) {
            console.log('❌ Self-matching detected in database lookup, creating new waiting entry instead');
            // Create a new waiting entry instead of matching with self
            try {
              console.log('💾 Creating new waiting entry (avoiding self-match from DB)...');
              const waitingMatch = queryRunner.manager.create(Match, {
                player1: wallet,
                player2: null,
                entryFee: entryFee,
                status: 'waiting',
                word: null
              });
              
              const savedMatch = await queryRunner.manager.save(waitingMatch);
              console.log(`✅ New waiting entry saved to database with ID: ${savedMatch.id}`);
              
              await queryRunner.commitTransaction();
              
              res.json({
                status: 'waiting',
                message: 'Waiting for opponent',
                waitingCount: totalWaitingForStake
              });
              return;
            } catch (dbError) {
              console.error('❌ Failed to save new waiting entry:', dbError);
              await queryRunner.rollbackTransaction();
              return res.status(503).json({ error: 'Failed to join waiting queue - database error' });
            }
          }
          
          waitingPlayer = {
            wallet: match.player1,
            entryFee: match.entryFee,
            matchId: match.id
          };
          console.log(`🎯 Found valid waiting player in database: ${waitingPlayer.wallet}`);
        } else {
          console.log('⚠️ Found stale waiting match, ignoring:', {
            player2: match.player2,
            status: match.status
          });
        }
      } else {
        console.log('⏳ No waiting players found');
      }
      
      if (waitingPlayer) {
        // Additional validation: ensure we have a valid opponent
        if (!waitingPlayer.wallet || waitingPlayer.wallet === wallet) {
          console.log('❌ Invalid waiting player detected:', {
            waitingPlayer: waitingPlayer.wallet,
            currentPlayer: wallet
          });
          await queryRunner.rollbackTransaction();
          return res.status(400).json({ error: 'Invalid match configuration' });
        }
        
        // CRITICAL: Calculate the actual entry fee to use (lesser of the two amounts)
        const player1EntryFee = waitingPlayer.entryFee;
        const player2EntryFee = entryFee;
        const actualEntryFee = Math.min(player1EntryFee, player2EntryFee);
        
        console.log('🎮 Creating match between players:', {
          player1: waitingPlayer.wallet,
          player2: wallet,
          player1EntryFee: player1EntryFee,
          player2EntryFee: player2EntryFee,
          actualEntryFee: actualEntryFee
        });
        console.log('💰 Using lesser entry fee for fair wagering:', actualEntryFee, 'SOL');
        
        // CRITICAL: Final validation to prevent self-matching
        if (waitingPlayer.wallet === wallet) {
          console.log('❌ CRITICAL ERROR: Attempting to create self-match in final validation');
          await queryRunner.rollbackTransaction();
          return res.status(400).json({ error: 'Self-matching not allowed' });
        }
        
        // CRITICAL: Ensure we have two distinct players
        if (!waitingPlayer.wallet || !wallet || waitingPlayer.wallet === wallet) {
          console.log('❌ CRITICAL ERROR: Invalid match configuration - missing or duplicate players');
          await queryRunner.rollbackTransaction();
          return res.status(400).json({ error: 'Invalid match configuration - requires two distinct players' });
        }
        
        try {
          // Create escrow account for the match using the lesser entry fee
          const { createEscrowAccount } = require('../services/payoutService');
          console.log('🔒 Calling createEscrowAccount with parameters:', {
            matchId: waitingPlayer.matchId,
            player1: waitingPlayer.wallet,
            player2: wallet,
            entryFee: actualEntryFee
          });
          const escrowResult = await createEscrowAccount(
            waitingPlayer.matchId,
            waitingPlayer.wallet,
            wallet,
            actualEntryFee
          );
          
          if (!escrowResult.success) {
            console.error('❌ Failed to create escrow account:', escrowResult.error);
            await queryRunner.rollbackTransaction();
            return res.status(500).json({ error: 'Failed to create escrow account' });
          }
          
          console.log('💰 Escrow account created:', escrowResult.escrowAddress);
          
          // Update the existing waiting match to become an active match
          const existingMatch = await queryRunner.manager.findOne(Match, { where: { id: waitingPlayer.matchId } });
          
          if (!existingMatch) {
            console.error('❌ Waiting match not found during update');
            await queryRunner.rollbackTransaction();
            return res.status(404).json({ error: 'Waiting match not found' });
          }
          
          // CRITICAL: Double-check this isn't a self-match before updating
          if (existingMatch.player1 === wallet) {
            console.log('❌ CRITICAL ERROR: Attempting to create self-match in final validation');
            await queryRunner.rollbackTransaction();
            return res.status(400).json({ error: 'Self-matching not allowed' });
          }
          
          // Generate a random 5-letter word for the game
          const { getRandomWord } = require('../wordList');
          const gameWord = getRandomWord();
          
          existingMatch.player2 = wallet;
          existingMatch.status = 'escrow'; // Changed from 'active' to 'escrow'
          existingMatch.word = gameWord;
          existingMatch.escrowAddress = escrowResult.escrowAddress;
          existingMatch.gameStartTime = new Date();
          existingMatch.entryFee = actualEntryFee; // Use the lesser entry fee
          
          const updatedMatch = await queryRunner.manager.save(existingMatch);
          
          console.log('✅ Match created successfully with transaction isolation');
          console.log('🎮 Match details:', {
            id: updatedMatch.id,
            player1: updatedMatch.player1,
            player2: updatedMatch.player2,
            word: updatedMatch.word,
            entryFee: updatedMatch.entryFee,
            escrowAddress: updatedMatch.escrowAddress,
            status: updatedMatch.status
          });
          
          await queryRunner.commitTransaction();
          
          // Verify the match was saved properly
          const { AppDataSource } = require('../db/index');
          const verifyRepository = AppDataSource.getRepository(Match);
          const verifiedMatch = await verifyRepository.findOne({ where: { id: updatedMatch.id } });
          
          if (verifiedMatch && verifiedMatch.status === 'escrow') {
            console.log('✅ Match verified in database after commit');
            
            // Small delay to ensure database is fully updated
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Double-check both players can see the match
            const player1Match = await verifyRepository.findOne({ 
              where: { player1: updatedMatch.player1, status: 'escrow' }
            });
            const player2Match = await verifyRepository.findOne({ 
              where: { player2: updatedMatch.player2, status: 'escrow' }
            });
            
            if (player1Match && player2Match) {
              console.log('✅ Both players can see the escrow match');
            } else {
              console.warn('⚠️ Match visibility issue detected');
            }
          } else {
            console.error('❌ Match not found or not in escrow after commit');
          }
          
          res.json({
            status: 'matched',
            matchId: updatedMatch.id,
            player1: updatedMatch.player1,
            player2: updatedMatch.player2,
            entryFee: updatedMatch.entryFee, // This is now the lesser amount
            escrowAddress: updatedMatch.escrowAddress,
            message: 'Match created - please lock your entry fee'
          });
        } catch (matchError) {
          console.error('❌ Failed to create match:', matchError);
          await queryRunner.rollbackTransaction();
          return res.status(500).json({ error: 'Failed to create match' });
        }
      } else {
        // No waiting player found, create a new waiting entry
        // But first check if this player already has a waiting entry
        const existingWaitingEntry = await queryRunner.manager.findOne(Match, {
          where: {
            player1: wallet,
            status: 'waiting',
            player2: null
          }
        });
        
        if (existingWaitingEntry) {
          console.log('⚠️ Player already has waiting entry, returning existing status');
          await queryRunner.rollbackTransaction();
          res.json({
            status: 'waiting',
            message: 'Already waiting for opponent',
            waitingCount: totalWaitingForStake
          });
          return;
        }
        
        try {
          console.log('💾 Creating new waiting entry...');
          const waitingMatch = queryRunner.manager.create(Match, {
            player1: wallet,
            player2: null,
            entryFee: entryFee,
            status: 'waiting',
            word: null
          });
          
          const savedMatch = await queryRunner.manager.save(waitingMatch);
          console.log(`✅ New waiting entry saved to database with ID: ${savedMatch.id}`);
          
          await queryRunner.commitTransaction();
          
          res.json({
            status: 'waiting',
            message: 'Waiting for opponent',
            waitingCount: totalWaitingForStake
          });
        } catch (dbError) {
          console.error('❌ Failed to save new waiting entry:', dbError);
          await queryRunner.rollbackTransaction();
          return res.status(503).json({ error: 'Failed to join waiting queue - database error' });
        }
      }
      
    } catch (transactionError) {
      console.error('❌ Transaction error:', transactionError);
      await queryRunner.rollbackTransaction();
      return res.status(500).json({ error: 'Database transaction failed' });
    } finally {
      await queryRunner.release();
    }

  } catch (error) {
    console.error('❌ Error in requestMatchHandler:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Debug endpoint to check waiting players
const debugWaitingPlayersHandler = async (req, res) => {
  try {
    console.log('🔍 Debug: Checking waiting players...');
    
    let dbWaitingMatches = [];
    let dbActiveMatches = [];
    let useDatabase = false;
    
    // Try database first
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      useDatabase = true;
      
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
      useDatabase = false;
    }
    
    // Get in-memory matches
    const memoryWaitingMatches = [];
    const memoryActiveMatches = [];
    
    for (const [matchId, matchData] of inMemoryMatches) {
      if (matchData.status === 'waiting') {
        memoryWaitingMatches.push({
          id: matchId,
          player1: matchData.player1,
          entryFee: matchData.entryFee,
          source: 'memory'
        });
      } else if (matchData.status === 'active') {
        memoryActiveMatches.push({
          id: matchId,
          player1: matchData.player1,
          player2: matchData.player2,
          entryFee: matchData.entryFee,
          status: matchData.status,
          source: 'memory'
        });
      }
    }
    
    const totalWaiting = dbWaitingMatches.length + memoryWaitingMatches.length;
    const totalActive = dbActiveMatches.length + memoryActiveMatches.length;
    
    console.log('🔍 Debug results:', {
      database: { waiting: dbWaitingMatches.length, active: dbActiveMatches.length },
      memory: { waiting: memoryWaitingMatches.length, active: memoryActiveMatches.length },
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
        waitingCount: memoryWaitingMatches.length,
        activeCount: memoryActiveMatches.length,
        waitingPlayers: memoryWaitingMatches,
        activeMatches: memoryActiveMatches
      },
      total: {
        waitingCount: totalWaiting,
        activeCount: totalActive
      }
    });
    
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({ error: 'Debug endpoint failed' });
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
    const winnerAmount = entryFee * 0.9; // 90% of pot
    const feeAmount = entryFee * 0.1; // 10% fee

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
      // Losing tie: Both failed to solve - each pays 10% fee
      console.log('🤝 Losing tie: Both failed to solve - each pays 10% fee');
      const feeAmount = match.entryFee * 0.1;
      
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: feeAmount * 2, // Total fees from both players
        feeWallet: FEE_WALLET_ADDRESS,
        transactions: [
          {
            from: match.player1,
            to: FEE_WALLET_ADDRESS,
            amount: feeAmount,
            description: 'Platform fee (player 1)'
          },
          {
            from: match.player2,
            to: FEE_WALLET_ADDRESS,
            amount: feeAmount,
            description: 'Platform fee (player 2)'
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

    // Validate result structure
    if (typeof result.won !== 'boolean' || typeof result.numGuesses !== 'number' || !Array.isArray(result.guesses)) {
      return res.status(400).json({ error: 'Invalid result format' });
    }

    // Validate game rules
    if (result.numGuesses > 7) {
      return res.status(400).json({ error: 'Maximum 7 guesses allowed' });
    }

    // Validate time limit (2 minutes = 120000 milliseconds)
    if (result.totalTime > 120000) {
      return res.status(400).json({ error: 'Game time exceeded 2-minute limit' });
    }

    console.log('📝 Submitting result for match:', matchId);
    console.log('Wallet:', wallet);
    console.log('Result:', result);

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Validate that wallet is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Determine which player this is
    let isPlayer1 = false;
    if (wallet === match.player1) {
      isPlayer1 = true;
      match.player1Result = result;
    } else if (wallet === match.player2) {
      isPlayer1 = false;
      match.player2Result = result;
    }

    console.log(`📝 ${isPlayer1 ? 'Player 1' : 'Player 2'} result recorded`);

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
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          console.log('💰 Executing automated payment...');
          
          const paymentData = {
            matchId: matchId,
            winner: payoutResult.winner,
            loser: payoutResult.winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1,
            entryFee: updatedMatch.entryFee,
            escrowAddress: updatedMatch.escrowAddress
          };
          
          const paymentResult = await payout(paymentData);
          
          if (paymentResult.success) {
            console.log('✅ Automated payment transaction created');
            payoutResult.transaction = paymentResult.transaction;
            payoutResult.paymentSuccess = true;
          } else {
            console.error('❌ Failed to create payment transaction:', paymentResult.error);
            payoutResult.paymentSuccess = false;
            payoutResult.paymentError = paymentResult.error;
          }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.player1Result && updatedMatch.player2Result && 
              updatedMatch.player1Result.won && updatedMatch.player2Result.won) {
            // Winning tie - refund both players
            console.log('🤝 Winning tie - refunding both players...');
            
            const refundData = {
              matchId: matchId,
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
              entryFee: updatedMatch.entryFee,
              escrowAddress: updatedMatch.escrowAddress
            };
            
            const refundResult = await refundEscrow(refundData);
            
            if (refundResult.success) {
              console.log('✅ Refund transaction created');
              payoutResult.transaction = refundResult.transaction;
              payoutResult.paymentSuccess = true;
            } else {
              console.error('❌ Failed to create refund transaction:', refundResult.error);
              payoutResult.paymentSuccess = false;
              payoutResult.paymentError = refundResult.error;
            }
          } else {
            // Losing tie - each pays fee
            console.log('🤝 Losing tie - each player pays fee...');
            // Fee collection would be handled by the smart contract
            payoutResult.paymentSuccess = true;
          }
        }
        
        // Mark match as completed
        updatedMatch.isCompleted = true;
        updatedMatch.payoutResult = payoutResult;
        await matchRepository.save(updatedMatch);
        
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
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          console.log('💰 Executing automated payment...');
          
          const paymentData = {
            matchId: matchId,
            winner: payoutResult.winner,
            loser: payoutResult.winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1,
            entryFee: updatedMatch.entryFee,
            escrowAddress: updatedMatch.escrowAddress
          };
          
          const paymentResult = await payout(paymentData);
          
          if (paymentResult.success) {
            console.log('✅ Automated payment transaction created');
            payoutResult.transaction = paymentResult.transaction;
            payoutResult.paymentSuccess = true;
          } else {
            console.error('❌ Failed to create payment transaction:', paymentResult.error);
            payoutResult.paymentSuccess = false;
            payoutResult.paymentError = paymentResult.error;
          }
        }
        
        // Mark match as completed
        updatedMatch.isCompleted = true;
        updatedMatch.payoutResult = payoutResult;
        await matchRepository.save(updatedMatch);
        
        res.json({
          status: 'completed',
          winner: payoutResult.winner,
          payout: payoutResult,
          message: 'Game completed - other player solved first'
        });
      } else {
        // Save partial result and wait
        await matchRepository.save(match);
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player'
        });
      }
    }

  } catch (error) {
    console.error('❌ Error submitting result:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      matchId: req.body?.matchId,
      wallet: req.body?.wallet
    });
    res.status(500).json({ error: 'Failed to submit result' });
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
    
    // Check for active matches with this player
    const activeMatch = await matchRepository.findOne({
      where: [
        { player1: wallet, status: 'active' },
        { player2: wallet, status: 'active' },
        { player1: wallet, status: 'escrow' },
        { player2: wallet, status: 'escrow' }
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
      res.json({
        matched: true,
        matchId: activeMatch.id,
        status: activeMatch.status,
        player1: activeMatch.player1,
        player2: activeMatch.player2,
        word: activeMatch.word
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
  confirmEscrowHandler
}; 
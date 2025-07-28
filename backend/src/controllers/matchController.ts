const expressMatch = require('express');
const typeormMatch = require('typeorm');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');

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
    
    // Look for waiting players in database
    let waitingPlayer = null;
    
    try {
      console.log('🔍 Searching database for waiting players with entry fee:', entryFee);
      console.log('🔍 Entry fee type:', typeof entryFee);
      console.log('🔍 Entry fee value:', entryFee);
      
      const waitingMatches = await matchRepository.find({
        where: {
          status: 'waiting',
          entryFee: entryFee,
          player2: null
        },
        order: {
          createdAt: 'ASC'
        },
        take: 1
      });

      console.log(`🔍 Found ${waitingMatches.length} waiting matches in database`);
      console.log('🔍 Waiting matches:', waitingMatches);
      
      if (waitingMatches.length > 0) {
        const match = waitingMatches[0];
        waitingPlayer = {
          wallet: match.player1,
          entryFee: match.entryFee,
          matchId: match.id
        };
        console.log(`🎯 Found waiting player in database: ${waitingPlayer.wallet}`);
      } else {
        console.log('⏳ No waiting players found');
      }
    } catch (dbError) {
      console.error('❌ Database lookup failed:', dbError);
      console.error('❌ Error details:', {
        message: dbError.message,
        stack: dbError.stack,
        name: dbError.name
      });
      return res.status(503).json({ error: 'Database lookup failed - matchmaking unavailable' });
    }
    
    if (waitingPlayer) {
      // Match found! Create the game
      const matchId = Date.now().toString();
      const word = wordList[Math.floor(Math.random() * wordList.length)];
      
      console.log(`🎮 Creating match: ${waitingPlayer.wallet} vs ${wallet}, word: ${word}`);
      
      const matchData = {
        id: matchId,
        player1: waitingPlayer.wallet,
        player2: wallet,
        entryFee: entryFee,
        word: word,
        status: 'active',
        player1Result: null,
        player2Result: null,
        winner: null,
        payoutResult: null
      };
      
      // Update the existing match in database
      try {
        console.log('💾 Updating existing match in database...');
        const existingMatch = await matchRepository.findOne({
          where: { id: waitingPlayer.matchId }
        });
        
        if (existingMatch) {
          existingMatch.player2 = wallet;
          existingMatch.word = word;
          existingMatch.status = 'active';
          const savedMatch = await matchRepository.save(existingMatch);
          matchData.id = savedMatch.id;
          console.log(`✅ Match updated in database: ${matchData.id}`);
        }
      } catch (dbError) {
        console.error('❌ Database update failed:', dbError.message);
        return res.status(503).json({ error: 'Failed to create match - database error' });
      }
      
      // Store in memory for this instance only (for game state)
      inMemoryMatches.set(matchData.id, matchData);
      console.log(`✅ Match created successfully: ${matchData.id}`);

      res.json({
        status: 'matched',
        matchId: matchData.id,
        word: word
      });

    } else {
      // No match found, create a waiting entry
      console.log(`⏳ Player ${wallet} added to waiting queue for $${entryFee}`);
      
      try {
        console.log('💾 Creating waiting entry in database...');
        console.log('💾 Waiting entry data:', {
          player1: wallet,
          player2: null,
          entryFee: entryFee,
          status: 'waiting',
          word: null
        });
        
        const waitingMatch = matchRepository.create({
          player1: wallet,
          player2: null,
          entryFee: entryFee,
          status: 'waiting',
          word: null
        });
        
        console.log('💾 Waiting match created, saving to database...');
        const savedMatch = await matchRepository.save(waitingMatch);
        console.log(`✅ Waiting entry saved to database with ID: ${savedMatch.id}`);
        
        res.json({
          status: 'waiting',
          message: 'Waiting for opponent'
        });
      } catch (dbError) {
        console.error('❌ Failed to save waiting entry to database:', dbError);
        console.error('❌ Error details:', {
          message: dbError.message,
          stack: dbError.stack,
          name: dbError.name
        });
        return res.status(503).json({ error: 'Failed to join waiting queue - database error' });
      }
    }

  } catch (error) {
    console.error('❌ Error in requestMatch:', error);
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
      const matchRepository = typeormMatch.getRepository(Match);
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
    
    // Test 1: Check if TypeORM is available
    console.log('🔍 TypeORM available:', !!typeormMatch);
    
    // Test 2: Check if Match entity is available
    console.log('🔍 Match entity available:', !!Match);
    
    // Test 3: Check if AppDataSource is available
    const { AppDataSource } = require('../db/index');
    console.log('🔍 AppDataSource available:', !!AppDataSource);
    console.log('🔍 AppDataSource initialized:', AppDataSource.isInitialized);
    
    // Test 4: Try to get repository using AppDataSource
    try {
      const testRepo = AppDataSource.getRepository(Match);
      console.log('✅ Repository created successfully');
      res.json({ 
        status: 'ok', 
        message: 'Repository test successful',
        typeorm: !!typeormMatch,
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

// Helper function to determine winner and calculate payout instructions
const determineWinnerAndPayout = async (matchId, player1Result, player2Result) => {
  const matchRepository = typeormMatch.getRepository(Match);
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
  // 2. If both solved → Tie breaker by time (faster wins)
  // 3. If only one solved → That player wins
  // 4. If neither solved → Both lose (tie)
  
  if (player1Result && player2Result) {
    // Both players submitted results
    if (player1Result.won && !player2Result.won) {
      // Player 1 solved, Player 2 didn't
      winner = match.player1;
    } else if (player2Result.won && !player1Result.won) {
      // Player 2 solved, Player 1 didn't
      winner = match.player2;
    } else if (player1Result.won && player2Result.won) {
      // Both solved - tie breaker by time (faster wins)
      // Using microsecond precision for very accurate tie breaking
      const timeDiff = Math.abs(player1Result.totalTime - player2Result.totalTime);
      const tolerance = 0.001; // 1 millisecond tolerance for "exact" ties
      
      if (timeDiff < tolerance) {
        // Times are effectively identical - both pay fee
        winner = 'tie';
        console.log('⚖️ Exact time tie detected:', {
          player1Time: player1Result.totalTime,
          player2Time: player2Result.totalTime,
          difference: timeDiff,
          tolerance: tolerance
        });
      } else if (player1Result.totalTime < player2Result.totalTime) {
        winner = match.player1;
        console.log('🏆 Player 1 wins by time:', {
          player1Time: player1Result.totalTime,
          player2Time: player2Result.totalTime,
          difference: player2Result.totalTime - player1Result.totalTime
        });
      } else {
        winner = match.player2;
        console.log('🏆 Player 2 wins by time:', {
          player1Time: player1Result.totalTime,
          player2Time: player2Result.totalTime,
          difference: player1Result.totalTime - player2Result.totalTime
        });
      }
    } else {
      // Both didn't solve - both lose
      winner = 'tie';
    }
  } else if (player1Result && !player2Result) {
    // Only player 1 submitted result
    if (player1Result.won) {
      // Player 1 solved, Player 2 didn't (disconnected or lost)
      winner = match.player1;
    } else {
      // Player 1 didn't solve, Player 2 didn't solve - both lose
      winner = 'tie';
    }
  } else if (player2Result && !player1Result) {
    // Only player 2 submitted result
    if (player2Result.won) {
      // Player 2 solved, Player 1 didn't (disconnected or lost)
      winner = match.player2;
    } else {
      // Player 2 didn't solve, Player 1 didn't solve - both lose
      winner = 'tie';
    }
  } else {
    // No results submitted - both lose
    winner = 'tie';
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
    // Both players get 45% back, 10% fee
    const refundAmount = match.entryFee * 0.45;
    const feeAmount = match.entryFee * 0.1;

    payoutResult = {
      winner: 'tie',
      winnerAmount: 0,
      feeAmount: feeAmount,
      feeWallet: FEE_WALLET_ADDRESS,
      transactions: [
        {
          from: match.player1,
          to: match.player1,
          amount: refundAmount,
          description: 'Tie refund'
        },
        {
          from: match.player2,
          to: match.player2,
          amount: refundAmount,
          description: 'Tie refund'
        },
        {
          from: match.player1,
          to: FEE_WALLET_ADDRESS,
          amount: feeAmount / 2,
          description: 'Platform fee (player 1)'
        },
        {
          from: match.player2,
          to: FEE_WALLET_ADDRESS,
          amount: feeAmount / 2,
          description: 'Platform fee (player 2)'
        }
      ]
    };

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
    if (!result.won || typeof result.numGuesses !== 'number' || !Array.isArray(result.guesses)) {
      return res.status(400).json({ error: 'Invalid result format' });
    }

    console.log('📝 Submitting result for match:', matchId);
    console.log('Wallet:', wallet);
    console.log('Result:', result);

    const matchRepository = typeormMatch.getRepository(Match);
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

    // Check if both players have submitted results
  if (match.player1Result && match.player2Result) {
      console.log('🏁 Both players submitted results, determining winner...');
      
      const payoutResult = await determineWinnerAndPayout(matchId, match.player1Result, match.player2Result);
      
      res.json({
        status: 'completed',
        winner: match.winner,
        payout: payoutResult
      });
    } else {
      // Save partial result
      await matchRepository.save(match);
      
      res.json({
        status: 'waiting',
        message: 'Waiting for other player'
      });
    }

  } catch (error) {
    console.error('❌ Error submitting result:', error);
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
      const matchRepository = typeormMatch.getRepository(Match);
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

    console.log('✅ Returning match data:', {
      status: match.status,
      player1: match.player1,
      player2: match.player2,
      hasWord: !!match.word
    });

  res.json({
    status: match.status,
      player1: match.player1,
      player2: match.player2,
      word: match.word,
      player1Result: match.player1Result,
      player2Result: match.player2Result,
      winner: match.winner,
      payout: match.payoutResult
    });

  } catch (error) {
    console.error('❌ Error getting match status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  requestMatchHandler,
  submitResultHandler,
  getMatchStatusHandler,
  debugWaitingPlayersHandler,
  matchTestHandler,
  testRepositoryHandler
}; 
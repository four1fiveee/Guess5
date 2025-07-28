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

    // Look for waiting players in database
    let waitingPlayer = null;
    try {
      const matchRepository = typeormMatch.getRepository(Match);
      
      // Find a waiting player with the same entry fee
      const waitingMatches = await matchRepository.find({
        where: {
          status: 'waiting',
          entryFee: entryFee,
          player2: null // Only matches that are waiting for player 2
        },
        order: {
          createdAt: 'ASC' // First come, first served
        },
        take: 1
      });

      if (waitingMatches.length > 0) {
        waitingPlayer = {
          wallet: waitingMatches[0].player1,
          entryFee: waitingMatches[0].entryFee
        };
        console.log(`🎯 Found waiting player: ${waitingPlayer.wallet}`);
      }
    } catch (dbError) {
      console.warn('⚠️ Database lookup failed:', dbError.message);
    }
    
    if (waitingPlayer) {
      // Match found! Create the game
      const matchId = Date.now().toString();
    const word = wordList[Math.floor(Math.random() * wordList.length)];
      
      console.log(`🎮 Creating match: ${waitingPlayer.wallet} vs ${wallet}, word: ${word}`);
      
      // Create match object
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
      
      // Try to save to database, but always store in memory as fallback
      try {
        const matchRepository = typeormMatch.getRepository(Match);
        
        // Update the waiting match with player 2 and game data
        const existingMatch = await matchRepository.findOne({
          where: {
            status: 'waiting',
            entryFee: entryFee,
            player1: waitingPlayer.wallet,
            player2: null
          }
        });
        
        if (existingMatch) {
          existingMatch.player2 = wallet;
          existingMatch.word = word;
          existingMatch.status = 'active';
          const savedMatch = await matchRepository.save(existingMatch);
          matchData.id = savedMatch.id;
          console.log(`✅ Match updated in database: ${matchData.id}`);
        } else {
          // Fallback: create new match
          const match = matchRepository.create(matchData);
          const savedMatch = await matchRepository.save(match);
          matchData.id = savedMatch.id;
          console.log(`✅ Match saved to database: ${matchData.id}`);
        }
      } catch (dbError) {
        console.warn('⚠️ Database save failed, using in-memory match:', dbError.message);
        console.log(`✅ Match created in-memory: ${matchData.id}`);
      }
      
      // Always store in memory for fallback lookup
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
        const matchRepository = typeormMatch.getRepository(Match);
        const waitingMatch = matchRepository.create({
          player1: wallet,
          player2: null, // Will be filled when matched
          entryFee: entryFee,
          status: 'waiting',
          word: null // Will be set when matched
        });
        
        await matchRepository.save(waitingMatch);
        console.log(`✅ Waiting entry saved to database`);
      } catch (dbError) {
        console.warn('⚠️ Failed to save waiting entry to database:', dbError.message);
      }
      
      res.json({
        status: 'waiting',
        message: 'Waiting for opponent'
      });
    }

  } catch (error) {
    console.error('❌ Error in requestMatch:', error);
    res.status(500).json({ error: 'Internal server error' });
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
  requestMatch: requestMatchHandler,
  submitResult: submitResultHandler,
  getMatchStatus: getMatchStatusHandler
}; 
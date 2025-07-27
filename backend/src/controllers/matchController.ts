const expressMatch = require('express');
const typeormMatch = require('typeorm');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');

// In-memory storage for matchmaking queue only
const matchmakingQueue = [];

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

    // Check if there's already a player waiting
    const waitingPlayer = matchmakingQueue.find(p => p.wallet !== wallet);
    
    if (waitingPlayer) {
      // Match found! Create the game
      const matchId = Date.now().toString();
      const word = wordList[Math.floor(Math.random() * wordList.length)];
      
      console.log(`🎮 Creating match: ${waitingPlayer.wallet} vs ${wallet}, word: ${word}`);
      
      // Try to create match in database, but fallback to in-memory if DB fails
      let matchIdToUse = matchId;
      try {
        const matchRepository = typeormMatch.getRepository(Match);
        const match = matchRepository.create({
          player1: waitingPlayer.wallet,
          player2: wallet,
          entryFee: entryFee,
          word: word,
          status: 'active'
        });

        const savedMatch = await matchRepository.save(match);
        matchIdToUse = savedMatch.id;
        console.log(`✅ Match saved to database: ${matchIdToUse}`);
      } catch (dbError) {
        console.warn('⚠️ Database save failed, using in-memory match:', dbError.message);
        console.log(`✅ Match created in-memory: ${matchIdToUse}`);
      }

      // Remove the waiting player from queue
      const index = matchmakingQueue.findIndex(p => p.wallet === waitingPlayer.wallet);
      if (index > -1) {
        matchmakingQueue.splice(index, 1);
      }

      console.log(`✅ Match created successfully: ${matchIdToUse}`);

      res.json({
        status: 'matched',
        matchId: matchIdToUse,
        word: word
      });

    } else {
      // No match found, add to queue
      matchmakingQueue.push({ wallet, entryFee });
      console.log(`⏳ Player ${wallet} added to queue. Queue size: ${matchmakingQueue.length}`);
      
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

  // Determine winner based on game results
  if (player1Result && player2Result) {
    if (player1Result.won && !player2Result.won) {
      winner = match.player1;
    } else if (player2Result.won && !player1Result.won) {
      winner = match.player2;
    } else if (player1Result.won && player2Result.won) {
      // Both won - tie
      winner = 'tie';
    } else {
      // Both lost - tie
      winner = 'tie';
    }
  } else if (player1Result && !player2Result) {
    winner = match.player1;
  } else if (player2Result && !player1Result) {
    winner = match.player2;
  }

  console.log('🏆 Winner determined:', winner);

  // Update match with results
  match.player1Result = player1Result;
  match.player2Result = player2Result;
  match.winner = winner;
  match.status = 'completed';
  match.isCompleted = true;

  // Calculate payout instructions
  if (winner && winner !== 'tie') {
    const entryFee = match.entryFee || 0.1;
    const feeAmount = entryFee * 0.1; // 10% fee
    const winnerAmount = (entryFee * 2) - feeAmount; // Both entry fees minus fee

    // Direct payment model - loser pays winner and fee
    const loser = winner === match.player1 ? match.player2 : match.player1;
    
    payoutResult = {
      winner: winner,
      winnerAmount: winnerAmount,
      feeAmount: feeAmount,
      feeWallet: FEE_WALLET_ADDRESS,
      transactions: [
        {
          from: loser,
          to: winner,
          amount: winnerAmount,
          description: `Loser pays winner stake minus fee`
        },
        {
          from: loser,
          to: FEE_WALLET_ADDRESS,
          amount: feeAmount,
          description: `Loser pays fee to fee wallet`
        }
      ]
    };

    console.log('💰 Payout calculated:', payoutResult);
  } else {
    // Tie - no payout
    payoutResult = {
      winner: 'tie',
      winnerAmount: 0,
      feeAmount: 0,
      feeWallet: FEE_WALLET_ADDRESS,
      transactions: []
    };
  }

  // Store payout result in match
  match.payoutResult = payoutResult;
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
    
    const matchRepository = typeormMatch.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

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
    console.error('Error getting match status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  requestMatch: requestMatchHandler,
  submitResult: submitResultHandler,
  getMatchStatus: getMatchStatusHandler
}; 
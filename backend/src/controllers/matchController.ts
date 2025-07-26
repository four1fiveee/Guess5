import { Request, Response } from 'express'
import { getRepository } from 'typeorm'
import { Match } from '../models/Match'
import { anchorInitGame } from '../services/anchorClient'
import wordList from '../wordList'
import { dbConnected } from '../app'

// In-memory waiting queue (for demo; use Redis or DB for production)
const waitingPlayers: { entryFee: number, wallet: string }[] = [];
const inMemoryMatches: { [key: string]: any } = {};

// Handle match request (player joins lobby)
export const requestMatch = async (req: Request, res: Response) => {
  const { entryFee, wallet } = req.body;

  // Check for a waiting player with the same entry fee
  const waitingIndex = waitingPlayers.findIndex(p => p.entryFee === entryFee && p.wallet !== wallet);

  if (waitingIndex === -1) {
    // No one waiting, add this player to the queue
    waitingPlayers.push({ entryFee, wallet });
    return res.json({ status: 'waiting' });
  } else {
    // Found a match!
    const opponent = waitingPlayers.splice(waitingIndex, 1)[0];
    // Pick a random word
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    
    if (dbConnected) {
      try {
        // Try to create match in DB if available
        const matchRepo = getRepository(Match);
        const match = matchRepo.create({
          player1: opponent.wallet,
          player2: wallet,
          entryFee,
          word,
          status: 'in_progress',
          player1Result: null,
          player2Result: null,
          winner: null
        });
        const savedMatch = await matchRepo.save(match);
        // Also store in memory as backup
        inMemoryMatches[savedMatch.id] = {
          player1: opponent.wallet,
          player2: wallet,
          entryFee,
          word,
          status: 'in_progress'
        };
        return res.json({ status: 'matched', matchId: savedMatch.id, word });
      } catch (error) {
        console.error('Database error, using in-memory storage:', error);
        // Fallback to in-memory storage
        const matchId = Date.now().toString();
        inMemoryMatches[matchId] = {
          player1: opponent.wallet,
          player2: wallet,
          entryFee,
          word,
          status: 'in_progress'
        };
        return res.json({ status: 'matched', matchId, word });
      }
    } else {
      // Fallback to in-memory storage
      const matchId = Date.now().toString();
      inMemoryMatches[matchId] = {
        player1: opponent.wallet,
        player2: wallet,
        entryFee,
        word,
        status: 'in_progress'
      };
      return res.json({ status: 'matched', matchId, word });
    }
  }
}

// Handle match confirmation (both players ready)
export const confirmMatch = async (req: Request, res: Response) => {
  try {
    // ... logic to confirm match and call Anchor contract
    await anchorInitGame({});
    res.json({ success: true })
  } catch (error) {
    console.error('Match confirmation error:', error);
    res.json({ success: true }) // Still return success for demo
  }
}

export const finishMatch = async (req: Request, res: Response) => {
  const { matchId, player, solved, numGuesses, totalTime } = req.body
  
  if (dbConnected) {
    try {
      const matchRepo = getRepository(Match)
      const match = await matchRepo.findOne({ where: { id: matchId } })
      if (match) {
        // Store result for player1 or player2
        if (player === match.player1) {
          match.player1Result = { solved, numGuesses, totalTime };
        } else if (player === match.player2) {
          match.player2Result = { solved, numGuesses, totalTime };
        }
        await matchRepo.save(match);
        // If both players are done, determine winner and trigger payout
        if (match.player1Result && match.player2Result) {
          // ...compare results, call contract for payout...
        }
      } else {
        // Fallback to in-memory storage
        const inMemoryMatch = inMemoryMatches[matchId];
        if (inMemoryMatch) {
          inMemoryMatch[player === inMemoryMatch.player1 ? 'player1Result' : 'player2Result'] = 
            { solved, numGuesses, totalTime };
        }
      }
    } catch (error) {
      console.error('Finish match error:', error);
      // Continue with in-memory storage
    }
  } else {
    // Fallback to in-memory storage
    const inMemoryMatch = inMemoryMatches[matchId];
    if (inMemoryMatch) {
      inMemoryMatch[player === inMemoryMatch.player1 ? 'player1Result' : 'player2Result'] = 
        { solved, numGuesses, totalTime };
    }
  }
  res.json({ success: true });
}

export const getMatchStatus = async (req: Request, res: Response) => {
  const { matchId } = req.params
  if (dbConnected) {
    try {
      const matchRepo = getRepository(Match)
      const match = await matchRepo.findOne({ where: { id: matchId } })
      if (match) {
        return res.json({
          status: match.status,
          player1Result: match.player1Result ?? null,
          player2Result: match.player2Result ?? null,
          winner: match.winner ?? null,
        });
      }
    } catch (error) {
      console.error('Get match status error:', error);
    }
  }
  // Fallback to in-memory storage
  const inMemoryMatch = inMemoryMatches[matchId];
  if (inMemoryMatch) {
    return res.json({
      status: inMemoryMatch.status,
      player1Result: inMemoryMatch.player1Result ?? null,
      player2Result: inMemoryMatch.player2Result ?? null,
      winner: inMemoryMatch.winner ?? null,
    });
  }
  return res.status(404).json({ error: 'Match not found' });
} 
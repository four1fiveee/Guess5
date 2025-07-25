import { Request, Response } from 'express'
import { getRepository } from 'typeorm'
import { Match } from '../models/Match'
import { anchorInitGame } from '../services/anchorClient'
import wordList from '../wordList'

// In-memory waiting queue (for demo; use Redis or DB for production)
const waitingPlayers: { entryFee: number, wallet: string }[] = [];

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
    // Create match in DB
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
    await matchRepo.save(match);
    // Respond to both players (in real app, notify both via WebSocket)
    return res.json({ status: 'matched', matchId: match.id, word });
  }
}

// Handle match confirmation (both players ready)
export const confirmMatch = async (req: Request, res: Response) => {
  // ... logic to confirm match and call Anchor contract
  await anchorInitGame()
  res.json({ success: true })
}

export const finishMatch = async (req: Request, res: Response) => {
  const { matchId, player, solved, numGuesses, totalTime } = req.body
  const matchRepo = getRepository(Match)
  const match = await matchRepo.findOne({ where: { id: matchId } })
  if (!match) return res.status(404).json({ error: 'Match not found' })

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
    // (You can add this logic here or in a service)
  }

  res.json({ success: true });
}

export const getMatchStatus = async (req: Request, res: Response) => {
  const { matchId } = req.params
  const matchRepo = getRepository(Match)
  const match = await matchRepo.findOne({ where: { id: matchId } })
  if (!match) return res.status(404).json({ error: 'Match not found' })
  res.json({
    status: match.status,
    player1Result: match.player1Result ?? null,
    player2Result: match.player2Result ?? null,
    winner: match.winner ?? null,
  });
} 
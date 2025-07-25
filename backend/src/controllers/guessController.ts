import { Request, Response } from 'express'
import { getRepository } from 'typeorm'
import { Guess } from '../models/Guess'

// Handle guess submission
export const submitGuess = async (req: Request, res: Response) => {
  const { matchId, player, guess, guessNumber, timeTaken } = req.body
  const guessRepo = getRepository(Guess)
  const newGuess = guessRepo.create({ matchId, player, guess, guessNumber, timeTaken })
  await guessRepo.save(newGuess)
  res.json({ success: true })
} 
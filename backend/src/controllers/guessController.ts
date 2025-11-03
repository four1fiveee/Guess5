const expressGuess = require('express')
const { Guess } = require('../models/Guess')

// Handle guess submission
const submitGuessHandler = async (req: any, res: any) => {
  try {
    const { matchId, player, guess, guessNumber, timeTaken } = req.body
    const { AppDataSource } = require('../db/index');
    const guessRepo = AppDataSource.getRepository(Guess)
    const newGuess = guessRepo.create({ matchId, player, guess, guessNumber, timeTaken })
    await guessRepo.save(newGuess)
    res.json({ success: true })
  } catch (error: unknown) {
    console.error('❌ Error submitting guess:', error);
    res.status(500).json({ error: 'Failed to submit guess' });
  }
}

module.exports = {
  submitGuess: submitGuessHandler
} 
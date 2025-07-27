const expressGuess = require('express')
const typeormGuess = require('typeorm')
const { Guess } = require('../models/Guess')

// Handle guess submission
const submitGuessHandler = async (req, res) => {
  const { matchId, player, guess, guessNumber, timeTaken } = req.body
  const guessRepo = typeormGuess.getRepository(Guess)
  const newGuess = guessRepo.create({ matchId, player, guess, guessNumber, timeTaken })
  await guessRepo.save(newGuess)
  res.json({ success: true })
}

module.exports = {
  submitGuess: submitGuessHandler
} 
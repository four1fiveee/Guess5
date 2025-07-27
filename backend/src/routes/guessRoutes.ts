const expressGuessRoutes = require('express')
const { submitGuess } = require('../controllers/guessController')

const guessRouter = expressGuessRoutes.Router()

// POST /api/guess
guessRouter.post('/', submitGuess)

module.exports = guessRouter 
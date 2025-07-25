import { Router } from 'express'
import { submitGuess } from '../controllers/guessController'

const router = Router()

// POST /api/guess
router.post('/', submitGuess)

export default router 
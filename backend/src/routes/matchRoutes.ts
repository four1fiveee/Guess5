import { Router } from 'express'
import { requestMatch, confirmMatch } from '../controllers/matchController'

const router = Router()

// GET /api/match/health - Health check for deployment
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Guess5 Backend is running' })
})

// POST /api/match/request
router.post('/request', requestMatch)

// POST /api/match/confirm
router.post('/confirm', confirmMatch)

export default router 
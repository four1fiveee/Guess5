import { Router } from 'express'
import { requestMatch, confirmMatch } from '../controllers/matchController'

const router = Router()

// POST /api/match/request
router.post('/request', requestMatch)

// POST /api/match/confirm
router.post('/confirm', confirmMatch)

export default router 
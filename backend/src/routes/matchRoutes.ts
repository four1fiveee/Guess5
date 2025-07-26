import { Router } from 'express';
import { 
  requestMatch, 
  getMatchStatus, 
  submitResult
} from '../controllers/matchController';

const router = Router();

router.post('/request-match', requestMatch);
router.get('/status/:matchId', getMatchStatus);
router.post('/submit-result', submitResult);

export default router; 
import { Router } from 'express';
import {
  createReferralLink,
  getReferralDashboard,
  getReferralStats
} from '../controllers/referralController';

const router = Router();

router.post('/link', createReferralLink);
router.get('/dashboard', getReferralDashboard);
router.get('/stats', getReferralStats);

export default router;


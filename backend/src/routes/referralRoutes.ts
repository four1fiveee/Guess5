import { Router } from 'express';
import {
  createReferralLink,
  getReferralDashboard,
  getReferralStats,
  downloadReferralPayoutsCSV
} from '../controllers/referralController';

const router = Router();

router.post('/link', createReferralLink);
router.get('/dashboard', getReferralDashboard);
router.get('/stats', getReferralStats);
router.get('/payouts/csv', downloadReferralPayoutsCSV);

export default router;


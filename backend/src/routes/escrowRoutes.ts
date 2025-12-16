import { Router } from 'express';
import {
  getInitializeTransaction,
  getDepositTransaction,
  submitGameResult,
  settleEscrow,
  getEscrowStateHandler,
  getSignedResult,
} from '../controllers/escrowController';

const router = Router();

router.post('/initialize-transaction', getInitializeTransaction);
router.post('/deposit-transaction', getDepositTransaction);
router.post('/submit-result', submitGameResult);
router.post('/settle', settleEscrow);
router.get('/state/:matchId', getEscrowStateHandler);
router.get('/signed-result/:matchId', getSignedResult);

export default router;


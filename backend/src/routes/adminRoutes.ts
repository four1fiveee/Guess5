import { Router } from 'express';
import {
  adminDeleteMatch,
  adminBackfillReferrals,
  adminGetOwedReferrals,
  adminPreparePayoutBatch,
  adminApprovePayoutBatch,
  adminSendPayoutBatch,
  adminGetPayoutBatches,
  adminGetPayoutBatch,
  adminGetAbuseFlags,
  adminGetExemptList,
  adminAddExempt,
  adminRemoveExempt,
  adminClearProposalLock,
  adminClearLockAndDeleteMatch,
  adminGetLockStats,
  adminCheckLockStatus,
  adminCleanupStaleLocks,
  adminExecuteProposal
} from '../controllers/adminController';

const router = Router();

// Match management
router.post('/delete-match/:matchId', adminDeleteMatch);
router.post('/clear-proposal-lock/:matchId', adminClearProposalLock);
router.post('/clear-lock-and-delete/:matchId', adminClearLockAndDeleteMatch);

// Proposal execution (admin recovery tool)
router.post('/execute-proposal/:matchId', adminExecuteProposal);

// Lock monitoring and management
router.get('/locks/stats', adminGetLockStats);
router.get('/locks/status/:matchId', adminCheckLockStatus);
router.post('/locks/cleanup', adminCleanupStaleLocks);

// Referral management
router.post('/referral/backfill', adminBackfillReferrals);
router.get('/referrals/owed', adminGetOwedReferrals);
router.get('/referrals/abuse-flags', adminGetAbuseFlags);
router.get('/referrals/exempt-list', adminGetExemptList);
router.post('/referrals/exempt', adminAddExempt);
router.post('/referrals/remove-exempt', adminRemoveExempt);

// Payout management
router.post('/payouts/prepare', adminPreparePayoutBatch);
router.post('/payouts/approve/:batchId', adminApprovePayoutBatch);
router.post('/payouts/send/:batchId', adminSendPayoutBatch);
router.get('/payouts/batches', adminGetPayoutBatches);
router.get('/payouts/batch/:id', adminGetPayoutBatch);

export default router;


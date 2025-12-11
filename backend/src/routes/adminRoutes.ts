// @ts-nocheck
const { Router } = require('express');
const {
  adminDeleteMatch,
  adminDeleteAllMatches,
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
  adminExecuteProposal,
  adminGetHealthStatus,
  adminGetFinancialMetrics,
  adminGetFeeWalletBalance,
  adminGetReferralPayoutExecution,
  adminLockReferralsWeek,
  adminExecutePayout,
  adminGetPayoutLockStatus
} = require('../controllers/adminController');
const { requireAdminAuth } = require('../middleware/adminAuth');

const router = Router();

// Apply admin authentication to all routes
router.use(requireAdminAuth);

// Match management
router.post('/delete-match/:matchId', adminDeleteMatch);
router.post('/delete-all-matches', adminDeleteAllMatches);
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

// Health monitoring
router.get('/health/status', adminGetHealthStatus);

// Financial metrics
router.get('/financial/metrics', adminGetFinancialMetrics);
router.get('/financial/fee-wallet-balance', adminGetFeeWalletBalance);

// Referral payout execution
router.get('/referrals/payout-execution', adminGetReferralPayoutExecution);
router.get('/referrals/payout-lock-status', adminGetPayoutLockStatus);
router.post('/referrals/lock-week', adminLockReferralsWeek);
router.post('/referrals/execute-payout', adminExecutePayout);

module.exports = router;

// @ts-nocheck
const { Router } = require('express');
const {
  getProposal,
  approveProposal,
  buildApprovalTransaction,
  cleanupStuckMatches,
} = require('../controllers/multisigController');
const matchController = require('../controllers/matchController');
const { asyncHandler: asyncHandlerWrapper } = require('../middleware/errorHandler');

// Import bot protection middleware
const { validateVercelBotProtection } = require('../middleware/vercelBotProtection');
const { 
  ipLimiter,
  vaultLimiter,
  paymentLimiter
} = require('../middleware/rateLimiter');

const router = Router();

// Handle player deposit to multisig vault
router.post('/deposits',
  ipLimiter,
  validateVercelBotProtection,
  paymentLimiter,
  asyncHandlerWrapper(matchController.depositToMultisigVaultHandler)
);

// Get proposal details for a match
router.get('/proposals/:matchId', getProposal);

// Build unsigned approval transaction for frontend signing
router.get('/build-approval/:matchId', buildApprovalTransaction);

// Player approval endpoint (frontend sends signed transaction)
router.post('/proposals/:matchId/approve',
  ipLimiter,
  validateVercelBotProtection,
  vaultLimiter,
  approveProposal
);

// Cleanup stuck matches (admin endpoint)
router.post('/cleanup-stuck-matches',
  ipLimiter,
  cleanupStuckMatches
);

module.exports = router;

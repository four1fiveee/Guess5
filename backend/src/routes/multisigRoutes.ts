// @ts-nocheck
const { Router } = require('express');
const {
  createMatchHandler,
  getMatchStatusHandler,
  submitAttestationHandler,
  refundTimeoutHandler,
  getAttestationsHandler,
  getAuditLogsHandler,
  processDepositHandler,
} = require('../controllers/multisigController');

// Import bot protection middleware
const { validateVercelBotProtection } = require('../middleware/vercelBotProtection');
const { 
  ipLimiter,
  vaultLimiter,
  paymentLimiter
} = require('../middleware/rateLimiter');

const router = Router();

// Create a new match with multisig vault (protected)
router.post('/matches', 
  ipLimiter,
  validateVercelBotProtection,
  vaultLimiter, // 2 vault operations per minute per wallet
  createMatchHandler
);

// Get match status including vault information (read-only, light protection)
router.get('/matches/:matchId/status', getMatchStatusHandler);

// Submit attestation for match settlement (protected)
router.post('/matches/:matchId/attestation',
  ipLimiter,
  validateVercelBotProtection,
  vaultLimiter,
  submitAttestationHandler
);

// Process refund for timeout scenarios (protected)
router.post('/matches/:matchId/refund',
  ipLimiter,
  validateVercelBotProtection,
  vaultLimiter,
  refundTimeoutHandler
);

// Get attestations for a match (read-only)
router.get('/matches/:matchId/attestations', getAttestationsHandler);

// Get audit logs for a match (read-only)
router.get('/matches/:matchId/audit-logs', getAuditLogsHandler);

// Process deposit to vault (protected)
router.post('/deposits',
  ipLimiter,
  validateVercelBotProtection,
  paymentLimiter, // 5 deposits per minute per wallet
  processDepositHandler
);

module.exports = router;

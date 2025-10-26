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

const router = Router();

// Create a new match with multisig vault
router.post('/matches', createMatchHandler);

// Get match status including vault information
router.get('/matches/:matchId/status', getMatchStatusHandler);

// Submit attestation for match settlement
router.post('/matches/:matchId/attestation', submitAttestationHandler);

// Process refund for timeout scenarios
router.post('/matches/:matchId/refund', refundTimeoutHandler);

// Get attestations for a match
router.get('/matches/:matchId/attestations', getAttestationsHandler);

// Get audit logs for a match
router.get('/matches/:matchId/audit-logs', getAuditLogsHandler);

// Process deposit to vault
router.post('/deposits', processDepositHandler);

module.exports = router;

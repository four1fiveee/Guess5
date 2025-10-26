const { Router } = require('express');
const multisigController = require('../controllers/multisigController');

const router = Router();

// Create a new match with multisig vault
router.post('/matches', multisigController.createMatchHandler);

// Get match status including vault information
router.get('/matches/:matchId/status', multisigController.getMatchStatusHandler);

// Submit attestation for match settlement
router.post('/matches/:matchId/attestation', multisigController.submitAttestationHandler);

// Process refund for timeout scenarios
router.post('/matches/:matchId/refund', multisigController.refundTimeoutHandler);

// Get attestations for a match
router.get('/matches/:matchId/attestations', multisigController.getAttestationsHandler);

// Get audit logs for a match
router.get('/matches/:matchId/audit-logs', multisigController.getAuditLogsHandler);

// Process deposit to vault
router.post('/deposits', multisigController.processDepositHandler);

module.exports = router;

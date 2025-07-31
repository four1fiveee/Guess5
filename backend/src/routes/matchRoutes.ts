const expressMatchRoutes = require('express');
const matchController = require('../controllers/matchController');

const router = expressMatchRoutes.Router();

// Test endpoints (only in development)
if (process.env.NODE_ENV !== 'production') {
  router.get('/test', matchController.matchTestHandler);
  router.get('/test-repository', matchController.testRepositoryHandler);
  router.get('/test-database', matchController.testDatabaseHandler);
  router.post('/cleanup-self-matches', matchController.cleanupSelfMatchesHandler);
  router.get('/debug/waiting', matchController.debugWaitingPlayersHandler);
}

// Match routes
router.post('/request-match', matchController.requestMatchHandler);
router.post('/submit-result', matchController.submitResultHandler);
router.post('/confirm-escrow', matchController.confirmEscrowHandler);
router.post('/create-escrow-transaction', matchController.createEscrowTransactionHandler);
router.get('/status/:matchId', matchController.getMatchStatusHandler);
router.get('/check-match/:wallet', matchController.checkPlayerMatchHandler);

// Server-side game state endpoints
router.post('/submit-guess', matchController.submitGameGuessHandler);
router.get('/game-state', matchController.getGameStateHandler);

// Server-side payment execution
router.post('/execute-payment', matchController.executePaymentHandler);

module.exports = router; 
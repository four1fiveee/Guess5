const expressRouter = require('express');
const router = expressRouter.Router();
const matchController = require('../controllers/matchController');
const { validateMatchRequest: validateMatch, validateSubmitResult: validateResult, validateEscrow: validateEscrowData } = require('../middleware/validation');
const { asyncHandler: asyncHandlerWrapper } = require('../middleware/errorHandler');

// Production routes (always available) - Updated with cleanup endpoints
router.post('/request-match', validateMatch, asyncHandlerWrapper(matchController.requestMatchHandler));
router.post('/submit-result', validateResult, asyncHandlerWrapper(matchController.submitResultHandler));
router.get('/status/:matchId', asyncHandlerWrapper(matchController.getMatchStatusHandler));
router.get('/check-match/:wallet', asyncHandlerWrapper(matchController.checkPlayerMatchHandler));
router.post('/confirm-escrow', validateEscrowData, asyncHandlerWrapper(matchController.confirmEscrowHandler));
router.post('/submit-guess', asyncHandlerWrapper(matchController.submitGameGuessHandler));
router.get('/game-state', asyncHandlerWrapper(matchController.getGameStateHandler));
router.post('/execute-payment', asyncHandlerWrapper(matchController.executePaymentHandler));
router.post('/create-escrow-transaction', asyncHandlerWrapper(matchController.createEscrowTransactionHandler));
router.post('/cleanup-stuck-matches', asyncHandlerWrapper(matchController.cleanupStuckMatchesHandler));
router.post('/cleanup-self-matches', asyncHandlerWrapper(matchController.cleanupSelfMatchesHandler));
router.post('/cleanup', asyncHandlerWrapper(matchController.simpleCleanupHandler));
router.get('/cleanup', asyncHandlerWrapper(matchController.simpleCleanupHandler));
router.post('/force-cleanup-wallet', asyncHandlerWrapper(matchController.forceCleanupForWallet));

// Development-only routes
if (process.env.NODE_ENV !== 'production') {
  router.get('/debug/waiting', asyncHandlerWrapper(matchController.debugWaitingPlayersHandler));
  router.get('/test', asyncHandlerWrapper(matchController.matchTestHandler));
  router.get('/test-repository', asyncHandlerWrapper(matchController.testRepositoryHandler));
  router.get('/test-database', asyncHandlerWrapper(matchController.testDatabaseHandler));
}

module.exports = router; 
const expressRouter = require('express');
const router = expressRouter.Router();
const matchController = require('../controllers/matchController');
const { validateMatchRequest: validateMatch, validateSubmitResult: validateResult, validateEscrow: validateEscrowData } = require('../middleware/validation');
const { asyncHandler: asyncHandlerWrapper } = require('../middleware/errorHandler');

// Production routes (always available)
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

// Development-only routes
if (process.env.NODE_ENV !== 'production') {
  router.get('/debug/waiting', asyncHandlerWrapper(matchController.debugWaitingPlayersHandler));
  router.get('/test', asyncHandlerWrapper(matchController.matchTestHandler));
  router.get('/test-repository', asyncHandlerWrapper(matchController.testRepositoryHandler));
  router.get('/test-database', asyncHandlerWrapper(matchController.testDatabaseHandler));
  router.post('/cleanup-self-matches', asyncHandlerWrapper(matchController.cleanupSelfMatchesHandler));
}

module.exports = router; 
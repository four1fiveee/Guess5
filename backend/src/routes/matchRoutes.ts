const expressRouter = require('express');
const router = expressRouter.Router();
const matchController = require('../controllers/matchController');
const { 
  validateMatchRequest: validateMatch, 
  validateSubmitResult: validateResult, 
  validateEscrow: validateEscrowData,
  validateConfirmPayment: validateConfirmPaymentData,
  validateReCaptcha,
  createRateLimiter
} = require('../middleware/validation');
const { asyncHandler: asyncHandlerWrapper } = require('../middleware/errorHandler');

// Wallet-based rate limiters (very lenient for testing)
const walletMatchmakingLimiter = createRateLimiter(30 * 1000, 500); // 500 requests per 30 seconds per wallet (very lenient)
const walletGameLimiter = createRateLimiter(60 * 1000, 1000); // 1000 requests per minute per wallet (very lenient)
const walletResultLimiter = createRateLimiter(60 * 1000, 200); // 200 result submissions per minute per wallet (very lenient)

// Production routes with enhanced security
router.post('/request-match', 
  walletMatchmakingLimiter,
  validateMatch, 
  validateReCaptcha,
  asyncHandlerWrapper(matchController.requestMatchHandler)
);

router.post('/submit-result', 
  walletResultLimiter,
  validateResult, 
  validateReCaptcha,
  asyncHandlerWrapper(matchController.submitResultHandler)
);

router.post('/submit-guess', 
  // Very lenient rate limiting for guess submission
  createRateLimiter(60 * 1000, 500), // 500 guesses per minute per wallet
  validateReCaptcha,
  asyncHandlerWrapper(matchController.submitGameGuessHandler)
);

router.post('/confirm-payment', 
  walletGameLimiter,
  validateConfirmPaymentData,
  validateReCaptcha,
  asyncHandlerWrapper(matchController.confirmPaymentHandler)
);

// Less critical endpoints (still rate limited but no ReCaptcha for testing)
router.get('/status/:matchId', 
  walletGameLimiter,
  asyncHandlerWrapper(matchController.getMatchStatusHandler)
);

router.get('/check-match/:wallet', 
  // No rate limiting for polling endpoint to avoid 429 errors
  asyncHandlerWrapper(matchController.checkPlayerMatchHandler)
);

// Real-time wallet balance updates via Server-Sent Events
router.get('/wallet-balance/:wallet', 
  // No rate limiting for SSE endpoint
  asyncHandlerWrapper(matchController.walletBalanceSSEHandler)
);

router.get('/game-state', 
  // No rate limiting for game state polling to avoid 429 errors
  asyncHandlerWrapper(matchController.getGameStateHandler)
);

// Legacy endpoints (kept for compatibility)
router.post('/confirm-escrow', validateEscrowData, asyncHandlerWrapper(matchController.confirmEscrowHandler));
router.post('/execute-payment', asyncHandlerWrapper(matchController.executePaymentHandler));
router.post('/create-escrow-transaction', asyncHandlerWrapper(matchController.createEscrowTransactionHandler));

// Cleanup endpoints (admin only)
router.post('/cleanup-stuck-matches', asyncHandlerWrapper(matchController.cleanupStuckMatchesHandler));
router.post('/cleanup-self-matches', asyncHandlerWrapper(matchController.cleanupSelfMatchesHandler));
router.post('/cleanup', asyncHandlerWrapper(matchController.simpleCleanupHandler));
router.get('/cleanup', asyncHandlerWrapper(matchController.simpleCleanupHandler));
router.post('/force-cleanup-wallet', asyncHandlerWrapper(matchController.forceCleanupForWallet));
router.get('/memory-stats', asyncHandlerWrapper(matchController.memoryStatsHandler));

// Manual refund endpoint for testing
router.post('/manual-refund', asyncHandlerWrapper(matchController.manualRefundHandler));

// Manual match endpoint for testing
router.post('/manual-match', asyncHandlerWrapper(matchController.manualMatchHandler));

// Database migration endpoint
router.post('/run-migration', asyncHandlerWrapper(matchController.runMigrationHandler));

// Match report endpoint (CSV export)
router.get('/generate-report', asyncHandlerWrapper(matchController.generateReportHandler));

// Blockchain verification endpoint
router.post('/verify-blockchain/:matchId', asyncHandlerWrapper(matchController.verifyBlockchainDataHandler));

// WebSocket stats endpoint
router.get('/websocket-stats', asyncHandlerWrapper(matchController.websocketStatsHandler));

// Payment verification test endpoint
router.post('/test-payment-verification', asyncHandlerWrapper(async (req, res) => {
  const { signature, wallet, amount } = req.body;
  
  if (!signature || !wallet || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const result = await matchController.verifyPaymentTransaction(signature, wallet, amount);
  res.json(result);
}));

// Development-only routes
if (process.env.NODE_ENV !== 'production') {
  router.get('/debug/waiting', asyncHandlerWrapper(matchController.debugWaitingPlayersHandler));
  router.get('/debug/matches', asyncHandlerWrapper(matchController.debugMatchesHandler));
  router.get('/test', asyncHandlerWrapper(matchController.matchTestHandler));
  router.get('/test-repository', asyncHandlerWrapper(matchController.testRepositoryHandler));
  router.get('/test-database', asyncHandlerWrapper(matchController.testDatabaseHandler));
}

module.exports = router; 
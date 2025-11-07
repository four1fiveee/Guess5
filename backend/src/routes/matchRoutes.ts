// @ts-nocheck
const expressRouter = require('express');
const router = expressRouter.Router();
const matchController = require('../controllers/matchController');
const { getSolPriceHandler } = require('../services/solPriceService');
const { 
  validateMatchRequest: validateMatch, 
  validateSubmitResult: validateResult, 
  validateConfirmPayment: validateConfirmPaymentData
} = require('../middleware/validation');
const { asyncHandler: asyncHandlerWrapper } = require('../middleware/errorHandler');

// Import bot protection middleware
const { validateVercelBotProtection } = require('../middleware/vercelBotProtection');
const {
  ipLimiter,
  matchmakingLimiter,
  guessLimiter,
  paymentLimiter,
  resultLimiter,
} = require('../middleware/rateLimiter');
const {
  resolveCorsOrigin,
} = require('../config/corsOrigins');

// Production routes with multi-layer bot protection
router.post('/request-match', 
  validateVercelBotProtection, // Layer 1: Verify request came through Vercel
  matchmakingLimiter, // Layer 2: Wallet-based rate limiting (1 req/30sec per wallet)
  validateMatch, 
  asyncHandlerWrapper(matchController.requestMatchHandler)
);

router.post('/submit-result', 
  validateVercelBotProtection,
  resultLimiter, // 2 results per minute per wallet
  validateResult, 
  asyncHandlerWrapper(matchController.submitResultHandler)
);

router.post('/submit-guess', 
  validateVercelBotProtection,
  guessLimiter, // 10 guesses per minute per wallet
  asyncHandlerWrapper(matchController.submitGameGuessHandler)
);

router.post('/confirm-payment', 
  validateVercelBotProtection,
  paymentLimiter, // 5 payments per minute per wallet
  validateConfirmPaymentData,
  asyncHandlerWrapper(matchController.confirmPaymentHandler)
);

// SOL price endpoint to avoid CORS issues
router.get('/sol-price', 
  asyncHandlerWrapper(getSolPriceHandler)
);

// Less critical endpoints (still rate limited but no ReCaptcha for testing)
router.get('/status/:matchId', 
  // Removed rate limiting for match status - ReCaptcha provides sufficient protection
  asyncHandlerWrapper(matchController.getMatchStatusHandler)
);

router.get('/check-player-match/:walletAddress', 
  // Check if player has an active match
  asyncHandlerWrapper(matchController.checkPlayerMatchHandler)
);

router.get('/check-pending-claims/:wallet', 
  // Check if player has pending winnings/refunds that need to be claimed
  asyncHandlerWrapper(matchController.checkPendingClaimsHandler)
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

// OPTIONS handler for SSE endpoint to handle CORS preflight
router.options('/wallet-balance/:wallet', (req: any, res: any) => {
  const origin = resolveCorsOrigin(req.headers.origin);
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Cache-Control, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

router.get('/game-state', 
  // Removed rate limiting for game state polling - ReCaptcha provides sufficient protection
  asyncHandlerWrapper(matchController.getGameStateHandler)
);

// Smart contract integration endpoints
router.get('/get-match-pda/:matchId', 
  asyncHandlerWrapper(matchController.getMatchPdaHandler)
);

// Smart contract deposit endpoint
router.post('/deposit-to-smart-contract', 
  asyncHandlerWrapper(matchController.depositToSmartContractHandler)
);

// Smart contract settlement endpoint
router.post('/settle-match', 
  asyncHandlerWrapper(matchController.settleMatchHandler)
);

// Smart contract status endpoint
router.get('/smart-contract-status/:matchId', 
  asyncHandlerWrapper(matchController.getSmartContractStatusHandler)
);

// Smart contract deposit verification endpoint
router.post('/verify-deposit', 
  asyncHandlerWrapper(matchController.verifyDepositHandler)
);

// Smart contract deposit status endpoint
router.get('/deposit-status/:matchId', 
  asyncHandlerWrapper(matchController.getDepositStatusHandler)
);



// Admin endpoint to void/reset a problematic match
router.delete('/void-match/:matchId', asyncHandlerWrapper(matchController.voidMatchHandler));

// Proposal signing endpoints
router.get('/get-proposal-approval-transaction',
  asyncHandlerWrapper(matchController.getProposalApprovalTransactionHandler)
);

router.post('/sign-proposal',
  validateVercelBotProtection,
  asyncHandlerWrapper(matchController.signProposalHandler)
);

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

// Force proposal creation for stuck matches (for testing/devnet)
router.post('/force-proposal', asyncHandlerWrapper(matchController.forceProposalCreationHandler));

// Clear Redis matchmaking data endpoint (for testing)
router.post('/clear-matchmaking-data', asyncHandlerWrapper(matchController.clearMatchmakingDataHandler));

// ReCaptcha test endpoint
router.get('/test-recaptcha', asyncHandlerWrapper(async (req: any, res: any) => {
  const recaptchaSecret = process.env.RECAPTCHA_SECRET;
  res.json({
    recaptchaConfigured: !!recaptchaSecret,
    secretLength: recaptchaSecret ? recaptchaSecret.length : 0,
    environment: process.env.NODE_ENV,
    message: recaptchaSecret ? 'ReCaptcha is configured' : 'ReCaptcha is not configured'
  });
}));

// Database migration endpoints
router.post('/run-migration', asyncHandlerWrapper(matchController.runMigrationHandler));
router.post('/run-security-migration', asyncHandlerWrapper(async (req: any, res: any) => {
  const { runHighImpactSecurityMigration, checkMigrationStatus } = require('../utils/migrationHelper');
  
  try {
    const { action = 'check' } = req.body;
    
    if (action === 'run') {
      console.log('🚀 Running high-impact security migration...');
      const success = await runHighImpactSecurityMigration();
      if (success) {
        res.json({ success: true, message: 'High-impact security migration completed successfully' });
      } else {
        res.status(500).json({ error: 'Migration failed' });
      }
    } else {
      console.log('🔍 Checking migration status...');
      const status = await checkMigrationStatus();
      res.json({ success: true, status });
    }
  } catch (error: unknown) {
    console.error('❌ Migration error:', error);
    res.status(500).json({ error: 'Migration operation failed' });
  }
}));

// Match report endpoint (CSV export)
router.get('/generate-report', asyncHandlerWrapper(matchController.generateReportHandler));

// Blockchain verification endpoint
router.post('/verify-blockchain/:matchId', asyncHandlerWrapper(matchController.verifyBlockchainDataHandler));

// WebSocket stats endpoint
router.get('/websocket-stats', asyncHandlerWrapper(matchController.websocketStatsHandler));

// Payment verification test endpoint
router.post('/test-payment-verification', asyncHandlerWrapper(async (req: any, res: any) => {
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
  router.get('/debug/refund-signatures', asyncHandlerWrapper(matchController.debugRefundSignaturesHandler));
  router.get('/test', asyncHandlerWrapper(matchController.matchTestHandler));
  router.get('/test-repository', asyncHandlerWrapper(matchController.testRepositoryHandler));
  router.get('/test-database', asyncHandlerWrapper(matchController.testDatabaseHandler));
}

const fixMatchController = require('../controllers/fixMatchController');
router.post('/fix-tie-proposal/:matchId', asyncHandlerWrapper(fixMatchController.fixTieProposal));

module.exports = router; 





const expressMatchRoutes = require('express');
const matchController = require('../controllers/matchController');

const router = expressMatchRoutes.Router();

// Test endpoints
router.get('/test', matchController.matchTestHandler);
router.get('/test-repository', matchController.testRepositoryHandler);
router.get('/test-database', matchController.testDatabaseHandler);
router.post('/cleanup-self-matches', matchController.cleanupSelfMatchesHandler);

// Match routes
router.post('/request-match', matchController.requestMatchHandler);
router.post('/submit-result', matchController.submitResultHandler);
router.get('/status/:matchId', matchController.getMatchStatusHandler);
router.get('/check-match/:wallet', matchController.checkPlayerMatchHandler);
router.get('/debug/waiting', matchController.debugWaitingPlayersHandler); // Debug endpoint

module.exports = router; 
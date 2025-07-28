const expressMatchRoutes = require('express');
const matchController = require('../controllers/matchController');

const router = expressMatchRoutes.Router();

// Test endpoint
router.get('/test', matchController.matchTestHandler);

// Match routes
router.post('/request-match', matchController.requestMatchHandler);
router.post('/submit-result', matchController.submitResultHandler);
router.get('/status/:matchId', matchController.getMatchStatusHandler);
router.get('/debug/waiting', matchController.debugWaitingPlayersHandler); // Debug endpoint

module.exports = router; 
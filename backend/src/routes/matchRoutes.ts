const expressMatchRoutes = require('express');
const { requestMatch, submitResult, getMatchStatus, debugWaitingPlayers } = require('../controllers/matchController');

const router = expressMatchRoutes.Router();

// Match routes
router.post('/request-match', requestMatch);
router.post('/submit-result', submitResult);
router.get('/status/:matchId', getMatchStatus);
router.get('/debug/waiting', debugWaitingPlayers); // Debug endpoint

module.exports = router; 
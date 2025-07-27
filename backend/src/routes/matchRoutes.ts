const expressMatchRoutes = require('express');
const { 
  requestMatch, 
  getMatchStatus, 
  submitResult
} = require('../controllers/matchController');

const matchRouter = expressMatchRoutes.Router();

matchRouter.post('/request-match', requestMatch);
matchRouter.get('/status/:matchId', getMatchStatus);
matchRouter.post('/submit-result', submitResult);

module.exports = matchRouter; 
import { Router, Request, Response } from 'express';
import { lookupMatch, deleteMatches } from '../services/adminService';
import pino from 'pino';

const logger = pino();
const router = Router();

router.get('/match/lookup/:matchId', async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const match = await lookupMatch(matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    res.json(match);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to lookup match');
    res.status(500).json({ error: error.message });
  }
});

router.post('/match/delete', async (req: Request, res: Response) => {
  try {
    const { matchIds } = req.body;
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({ error: 'matchIds must be a non-empty array' });
    }

    logger.warn({ matchIds }, 'Admin match deletion requested (LOCAL ONLY)');
    const results = await deleteMatches(matchIds);
    res.json({ results });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to delete matches');
    res.status(500).json({ error: error.message });
  }
});

export default router;








import { Router, Request, Response } from 'express';
import { getCached, setCached } from '../services/cache';
import { getGameOpsSummary } from '../services/gameOpsService';
import { getFinanceSummary } from '../services/financeService';
import { getGrowthSummary } from '../services/growthService';
import { getInfraSummary } from '../services/infraService';
import { config } from '../config';
import pino from 'pino';

const logger = pino();
const router = Router();

router.get('/ops/summary', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const cacheKey = 'ops:summary';

    if (!force) {
      const cached = getCached(cacheKey, config.cache.ttl);
      if (cached) {
        return res.json({ timestamp: new Date().toISOString(), data: cached });
      }
    }

    const data = await getGameOpsSummary(force);
    setCached(cacheKey, data);
    res.json({ timestamp: new Date().toISOString(), data });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get ops summary');
    res.status(500).json({ error: error.message });
  }
});

router.get('/finance/summary', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const cacheKey = 'finance:summary';

    if (!force) {
      const cached = getCached(cacheKey, config.cache.ttl);
      if (cached) {
        return res.json({ timestamp: new Date().toISOString(), data: cached });
      }
    }

    const data = await getFinanceSummary(force);
    setCached(cacheKey, data);
    res.json({ timestamp: new Date().toISOString(), data });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get finance summary');
    res.status(500).json({ error: error.message });
  }
});

router.get('/growth/summary', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const cacheKey = 'growth:summary';

    if (!force) {
      const cached = getCached(cacheKey, config.cache.ttl);
      if (cached) {
        return res.json({ timestamp: new Date().toISOString(), data: cached });
      }
    }

    const data = await getGrowthSummary(force);
    setCached(cacheKey, data);
    res.json({ timestamp: new Date().toISOString(), data });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get growth summary');
    res.status(500).json({ error: error.message });
  }
});

router.get('/infra/summary', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const cacheKey = 'infra:summary';

    if (!force) {
      const cached = getCached(cacheKey, config.cache.ttl);
      if (cached) {
        return res.json({ timestamp: new Date().toISOString(), data: cached });
      }
    }

    const data = await getInfraSummary(force);
    setCached(cacheKey, data);
    res.json({ timestamp: new Date().toISOString(), data });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get infra summary');
    res.status(500).json({ error: error.message });
  }
});

export default router;








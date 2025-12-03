// @ts-nocheck
import { Router } from 'express';
import {
  setUsername,
  getUsername,
  checkUsernameAvailability
} from '../controllers/userController';

const { resolveCorsOrigin } = require('../config/corsOrigins');

const router = Router();

// OPTIONS handlers for CORS preflight requests
router.options('/username', (req: any, res: any) => {
  const origin = resolveCorsOrigin(req.headers.origin);
  const originToUse = origin || 'https://guess5.io';
  res.header('Access-Control-Allow-Origin', originToUse);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

router.options('/username/check', (req: any, res: any) => {
  const origin = resolveCorsOrigin(req.headers.origin);
  const originToUse = origin || 'https://guess5.io';
  res.header('Access-Control-Allow-Origin', originToUse);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

router.post('/username', setUsername);
router.get('/username', getUsername);
router.get('/username/check', checkUsernameAvailability);

export default router;


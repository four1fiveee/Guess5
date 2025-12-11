import { Router } from 'express';
import { adminLogin, adminLogout, adminAuthStatus } from '../middleware/adminAuth';

const router = Router();

// Public auth endpoints
router.post('/login', adminLogin);
router.post('/logout', adminLogout);
router.get('/status', adminAuthStatus);

export default router;


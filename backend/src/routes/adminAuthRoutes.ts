// @ts-nocheck
const { Router } = require('express');
const { adminLogin, adminLogout, adminAuthStatus } = require('../middleware/adminAuth');

const router = Router();

// Public auth endpoints
router.post('/login', adminLogin);
router.post('/logout', adminLogout);
router.get('/status', adminAuthStatus);

module.exports = router;

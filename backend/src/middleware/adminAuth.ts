// @ts-nocheck
const jwt = require('jsonwebtoken');

/**
 * Admin authentication middleware
 * Protects admin routes with JWT token verification
 */
// AdminRequest type for TypeScript (if needed)
// interface AdminRequest extends Request {
//   admin?: {
//     authenticated: boolean;
//     timestamp: number;
//   };
// }

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-in-production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Change in production!

/**
 * Generate JWT token for admin session
 */
function generateAdminToken(): string {
  return jwt.sign(
    {
      role: 'admin',
      authenticated: true,
      timestamp: Date.now(),
    },
    ADMIN_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Verify admin JWT token
 */
function verifyAdminToken(token: string): boolean {
  try {
    const decoded = jwt.verify(token, ADMIN_SECRET);
    return decoded?.role === 'admin' && decoded?.authenticated === true;
  } catch (error) {
    return false;
  }
}

// IP whitelisting removed - authentication is sufficient

/**
 * Get client IP address
 */
function getClientIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Admin authentication middleware
 * Requires valid JWT token in Authorization header
 */
function requireAdminAuth(req: any, res: any, next: any): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Admin authentication required. Please login first.'
    });
    return;
  }

  const token = authHeader.substring(7);
  
  if (!verifyAdminToken(token)) {
    res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or expired admin token. Please login again.'
    });
    return;
  }

  // IP whitelisting removed - JWT authentication is sufficient

  // Set admin context
  req.admin = {
    authenticated: true,
    timestamp: Date.now(),
  };

  next();
}

/**
 * Admin login endpoint handler
 * POST /api/admin/auth/login
 */
function adminLogin(req: any, res: any): void {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    console.warn(`⚠️ Failed admin login attempt from IP: ${getClientIp(req)} (username: ${username})`);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const token = generateAdminToken();
  const clientIp = getClientIp(req);

  console.log(`✅ Admin login successful from IP: ${clientIp}`);

  res.json({
    success: true,
    token,
    expiresIn: '24h',
    message: 'Admin authentication successful',
  });
}

/**
 * Admin logout endpoint handler
 * POST /api/admin/auth/logout
 */
function adminLogout(req: any, res: any): void {
  // JWT tokens are stateless, so logout is handled client-side
  // But we can log it for audit purposes
  console.log(`📤 Admin logout from IP: ${getClientIp(req)}`);
  
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}

/**
 * Check admin authentication status
 * GET /api/admin/auth/status
 */
function adminAuthStatus(req: any, res: any): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.json({ authenticated: false });
    return;
  }

  const token = authHeader.substring(7);
  const isValid = verifyAdminToken(token);
  const clientIp = getClientIp(req);

  res.json({
    authenticated: isValid,
    ip: clientIp,
  });
}

module.exports = {
  requireAdminAuth,
  adminLogin,
  adminLogout,
  adminAuthStatus,
  generateAdminToken,
};


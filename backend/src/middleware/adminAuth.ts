import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Admin authentication middleware
 * Protects admin routes with JWT token verification
 */
export interface AdminRequest extends Request {
  admin?: {
    authenticated: boolean;
    timestamp: number;
  };
}

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Change in production!
const ADMIN_IP_WHITELIST = process.env.ADMIN_IP_WHITELIST?.split(',').map(ip => ip.trim()) || [];

/**
 * Generate JWT token for admin session
 */
export function generateAdminToken(): string {
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
    const decoded = jwt.verify(token, ADMIN_SECRET) as any;
    return decoded?.role === 'admin' && decoded?.authenticated === true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if IP is whitelisted (if whitelist is configured)
 */
function isIpWhitelisted(ip: string): boolean {
  if (ADMIN_IP_WHITELIST.length === 0) {
    return true; // No whitelist = allow all (when authenticated)
  }
  return ADMIN_IP_WHITELIST.includes(ip);
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
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
export function requireAdminAuth(req: AdminRequest, res: Response, next: NextFunction): void {
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

  // Optional IP whitelisting check
  const clientIp = getClientIp(req);
  if (!isIpWhitelisted(clientIp)) {
    console.warn(`⚠️ Admin access attempt from non-whitelisted IP: ${clientIp}`);
    res.status(403).json({ 
      error: 'Forbidden',
      message: 'Your IP address is not authorized to access admin dashboard.'
    });
    return;
  }

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
export function adminLogin(req: Request, res: Response): void {
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: 'Password required' });
    return;
  }

  if (password !== ADMIN_PASSWORD) {
    console.warn(`⚠️ Failed admin login attempt from IP: ${getClientIp(req)}`);
    res.status(401).json({ error: 'Invalid password' });
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
export function adminLogout(req: Request, res: Response): void {
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
export function adminAuthStatus(req: AdminRequest, res: Response): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.json({ authenticated: false });
    return;
  }

  const token = authHeader.substring(7);
  const isValid = verifyAdminToken(token);
  const clientIp = getClientIp(req);
  const ipAllowed = isIpWhitelisted(clientIp);

  res.json({
    authenticated: isValid && ipAllowed,
    ip: clientIp,
    ipWhitelisted: ADMIN_IP_WHITELIST.length === 0 ? 'all' : ipAllowed,
  });
}


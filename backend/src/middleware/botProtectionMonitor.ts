/**
 * Bot Protection Monitoring and Logging
 * Tracks bot protection events for security analysis
 */

export const logBotProtection = (req: any, blocked: boolean, reason: string): void => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: blocked ? 'BOT_BLOCKED' : 'REQUEST_ALLOWED',
    ip: req.ip,
    path: req.path,
    method: req.method,
    reason,
    userAgent: req.get('user-agent'),
    vercelHeaders: {
      country: req.headers['x-vercel-ip-country'],
      city: req.headers['x-vercel-ip-city'],
      proxied: req.headers['x-vercel-proxied-for'],
      forwarded: req.headers['x-forwarded-for'],
    },
    requestBody: {
      wallet: (req.body && req.body.wallet) ? req.body.wallet : undefined,
      matchId: (req.body && req.body.matchId) ? req.body.matchId : undefined,
    }
  };

  if (blocked) {
    console.log('🚫 BOT PROTECTION EVENT:', JSON.stringify(logEntry));
  } else {
    // Only log allowed requests in verbose mode
    if (process.env.VERBOSE_LOGGING === 'true') {
      console.log('✅ REQUEST ALLOWED:', JSON.stringify(logEntry));
    }
  }
};

/**
 * Middleware wrapper for logging rate limit events
 */
export const rateLimitLogger = (req: any, res: any, next: any): void => {
  // Log rate limit headers if present
  const rateLimitRemaining = res.getHeader('RateLimit-Remaining');
  const rateLimitLimit = res.getHeader('RateLimit-Limit');
  
  if (rateLimitRemaining !== undefined && rateLimitLimit !== undefined) {
    console.log('📊 Rate Limit Status:', {
      path: req.path,
      wallet: (req.body && req.body.wallet) ? req.body.wallet : 'unknown',
      remaining: rateLimitRemaining,
      limit: rateLimitLimit,
      ip: req.ip
    });
  }
  
  next();
};


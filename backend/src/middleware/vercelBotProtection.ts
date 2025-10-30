/**
 * Middleware to validate Vercel Bot Protection headers
 * Vercel adds X-Vercel-IP-* headers for legitimate traffic that passes through their edge network
 * This helps prevent bots from bypassing Vercel and calling Render backend directly
 */
export const validateVercelBotProtection = async (
  req: any,
  res: any,
  next: any
): Promise<void> => {
  // Check for Vercel Bot Protection headers
  const vercelIPCountry = req.headers['x-vercel-ip-country'];
  const vercelIPCity = req.headers['x-vercel-ip-city'];
  const vercelProxiedFor = req.headers['x-vercel-proxied-for'];
  const vercelForwardedFor = req.headers['x-forwarded-for'];
  
  // In production, verify request came through Vercel's edge network
  if (process.env.NODE_ENV === 'production') {
    // Check if ANY Vercel header is present (flexible approach)
    const hasVercelHeaders = vercelIPCountry || vercelIPCity || vercelProxiedFor || vercelForwardedFor;
    
    if (!hasVercelHeaders) {
      console.log('🚫 Bot Protection: Request blocked - Missing Vercel headers (possible direct backend access)', {
        ip: req.ip,
        path: req.path,
        userAgent: req.get('user-agent'),
        headers: {
          'x-vercel-ip-country': vercelIPCountry,
          'x-vercel-ip-city': vercelIPCity,
          'x-vercel-proxied-for': vercelProxiedFor,
          'x-forwarded-for': vercelForwardedFor,
        }
      });
      
      res.status(403).json({ 
        error: 'Access denied',
        message: 'Requests must come through the official website'
      });
      return;
    }
    
    console.log('✅ Vercel bot protection passed', {
      ip: req.ip,
      country: vercelIPCountry,
      city: vercelIPCity,
      path: req.path
    });
  } else {
    // In development, allow all requests but log them
    console.log('🔧 Development mode: Vercel bot protection skipped', {
      ip: req.ip,
      path: req.path,
      hasVercelHeaders: !!(vercelIPCountry || vercelIPCity || vercelProxiedFor || vercelForwardedFor)
    });
  }
  
  next();
};


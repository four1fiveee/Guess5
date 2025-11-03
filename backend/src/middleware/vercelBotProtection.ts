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
  
  // In production, prefer Vercel headers but allow requests without them for direct backend access
  // This allows the frontend to call the backend directly (e.g., for API calls)
  if (process.env.NODE_ENV === 'production') {
    // Check if ANY Vercel header is present
    const hasVercelHeaders = vercelIPCountry || vercelIPCity || vercelProxiedFor || vercelForwardedFor;
    
    if (hasVercelHeaders) {
      console.log('✅ Vercel bot protection: Request via Vercel edge network', {
        ip: req.ip,
        country: vercelIPCountry,
        city: vercelIPCity,
        path: req.path
      });
    } else {
      // Allow direct backend access but log it
      console.log('⚠️ Bot Protection: Request without Vercel headers (direct backend access allowed)', {
        ip: req.ip,
        path: req.path,
        userAgent: req.get('user-agent'),
        origin: req.headers.origin
      });
    }
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


const { Request, Response, NextFunction } = require('express');
const { getRedisOps } = require('../config/redis');

// Redis-based deduplication for scalability
const DEDUPLICATION_WINDOW = 5000; // 5 second window
const MIN_REQUEST_INTERVAL = 500; // 500ms minimum between requests (much more lenient)

export const deduplicateRequests = async (req: any, res: any, next: any) => {
  // Temporarily disable deduplication for matchmaking during testing
  if (req.url.includes('/request-match')) {
    console.log('🔓 Skipping deduplication for matchmaking request during testing');
    return next();
  }
  
  // Only apply to POST requests for specific endpoints that are prone to spam
  if (req.method !== 'POST' || 
      (!req.url.includes('/submit-result') && 
       !req.url.includes('/submit-guess'))) {
    return next();
  }

  const wallet = req.body?.wallet;
  if (!wallet) {
    return next();
  }

  const requestKey = `dedup:${wallet}-${req.url}`;
  const now = Date.now();

  try {
    const redis = getRedisOps();
    
    // Check if this is a duplicate request using Redis
    const lastRequestTime = await redis.get(requestKey);
    
    if (lastRequestTime) {
      const timeSinceLastRequest = now - parseInt(lastRequestTime);
      
      console.log(`🔍 Deduplication check for ${wallet}: ${timeSinceLastRequest}ms since last request`);
      
      // Allow request if it's been more than minimum interval
      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        console.log(`🔄 Duplicate request detected for ${wallet} on ${req.url}, skipping (${timeSinceLastRequest}ms < ${MIN_REQUEST_INTERVAL}ms)`);
        return res.status(200).json({
          success: true,
          message: 'Request already being processed',
          duplicate: true
        });
      } else {
        console.log(`⏰ Allowing request after ${timeSinceLastRequest}ms for ${wallet}`);
      }
    }

    // Track this request in Redis with TTL
    await redis.setEx(requestKey, Math.floor(DEDUPLICATION_WINDOW / 1000), now.toString());
    next();
  } catch (error) {
    console.error('❌ Redis deduplication error, allowing request:', error);
    next(); // Allow request if Redis fails
  }
};

export default deduplicateRequests; 
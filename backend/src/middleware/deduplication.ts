const { Request, Response, NextFunction } = require('express');

// Track recent requests to prevent duplicates
const recentRequests = new Map<string, number>();
const DEDUPLICATION_WINDOW = 2000; // 2 second window (less aggressive)
const MIN_REQUEST_INTERVAL = 1000; // 1 second minimum between requests

export const deduplicateRequests = (req: any, res: any, next: any) => {
  // Only apply to POST requests for specific matchmaking endpoints that are prone to spam
  if (req.method !== 'POST' || 
      (!req.url.includes('/request-match') && 
       !req.url.includes('/submit-result') && 
       !req.url.includes('/submit-guess'))) {
    return next();
  }

  const wallet = req.body?.wallet;
  if (!wallet) {
    return next();
  }

  const requestKey = `${wallet}-${req.url}`;
  const now = Date.now();

  // Clean up old entries
  for (const [key, timestamp] of recentRequests.entries()) {
    if (now - timestamp > DEDUPLICATION_WINDOW) {
      recentRequests.delete(key);
    }
  }

  // Check if this is a duplicate request
  if (recentRequests.has(requestKey)) {
    const lastRequestTime = recentRequests.get(requestKey);
    const timeSinceLastRequest = now - lastRequestTime;
    
    console.log(`🔍 Deduplication check for ${wallet}: ${timeSinceLastRequest}ms since last request`);
    
    // Allow request if it's been more than 1 second (less aggressive)
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

  // Track this request
  recentRequests.set(requestKey, now);
  next();
};

export default deduplicateRequests; 
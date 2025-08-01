const { Request, Response, NextFunction } = require('express');

// Track recent requests to prevent duplicates
const recentRequests = new Map<string, number>();
const DEDUPLICATION_WINDOW = 1000; // 1 second window

export const deduplicateRequests = (req: any, res: any, next: any) => {
  // Only apply to POST requests for matchmaking
  if (req.method !== 'POST' || !req.url.includes('/api/match/')) {
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
    console.log(`🔄 Duplicate request detected for ${wallet} on ${req.url}, skipping`);
    return res.status(200).json({
      success: true,
      message: 'Request already being processed',
      duplicate: true
    });
  }

  // Track this request
  recentRequests.set(requestKey, now);
  next();
};

export default deduplicateRequests; 
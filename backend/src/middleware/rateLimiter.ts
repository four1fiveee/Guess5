const rateLimit = require('express-rate-limit');

/**
 * Rate limiting middleware to prevent bot abuse
 * Uses wallet addresses and IP addresses as keys
 */

// Matchmaking: 5 requests per minute per wallet
// Allows for legitimate retries while preventing bot abuse
export const matchmakingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Allow up to 5 requests per minute (covers retries)
  message: 'Too many matchmaking requests. Please wait before requesting another match.',
  keyGenerator: (req) => {
    // Rate limit by wallet address (from request body)
    const wallet = (req.body && req.body.wallet) ? req.body.wallet : req.ip;
    return `matchmaking:${wallet}`;
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded: Matchmaking', {
      ip: req.ip,
      wallet: req.body?.wallet,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many matchmaking requests',
      message: 'You have exceeded the matchmaking request limit. Please wait a minute before trying again.',
      retryAfter: 60
    });
  }
});

// Guess submission: 10 guesses per minute per wallet
// Normal gameplay: 7 guesses max, so 10/min is generous
export const guessLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute  
  max: 10,
  message: 'Too many guesses. Slow down!',
  keyGenerator: (req) => {
    const wallet = (req.body && req.body.wallet) ? req.body.wallet : req.ip;
    return `guess:${wallet}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded: Guess submission', {
      ip: req.ip,
      wallet: req.body?.wallet,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many guesses',
      message: 'Slow down! Maximum 10 guesses per minute.',
      retryAfter: 60
    });
  }
});

// Payment confirmation: 5 per minute per wallet
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many payment confirmations. Please wait.',
  keyGenerator: (req) => {
    const wallet = (req.body && req.body.wallet) ? req.body.wallet : req.ip;
    return `payment:${wallet}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded: Payment confirmation', {
      ip: req.ip,
      wallet: req.body?.wallet,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many payment confirmations',
      message: 'Please wait before confirming another payment.',
      retryAfter: 60
    });
  }
});

// Result submission: 10 per minute per wallet
// Increased to handle retries and edge cases where players may need multiple attempts
export const resultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many result submissions. Please wait.',
  keyGenerator: (req) => {
    const wallet = (req.body && req.body.wallet) ? req.body.wallet : req.ip;
    return `result:${wallet}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded: Result submission', {
      ip: req.ip,
      wallet: req.body?.wallet,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many result submissions',
      message: 'Please wait before submitting another result.',
      retryAfter: 60
    });
  }
});

// IP-based rate limiting (defense against bot farms)
// 20 requests per minute per IP across all endpoints
export const ipLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP
  message: 'Too many requests from this IP. Please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded: IP limit', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent')
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'Too many requests from your IP address. Please slow down.',
      retryAfter: 60
    });
  }
});

// Vault/multisig operations: 2 per minute per wallet
export const vaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  message: 'Too many vault operations. Please wait.',
  keyGenerator: (req) => {
    const wallet = (req.body && req.body.wallet) ? req.body.wallet : req.ip;
    return `vault:${wallet}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded: Vault operation', {
      ip: req.ip,
      wallet: req.body?.wallet,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many vault operations',
      message: 'Please wait before creating another vault or deposit.',
      retryAfter: 60
    });
  }
});


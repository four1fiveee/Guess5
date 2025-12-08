// @ts-nocheck
const express = require('express');
const cors = require('cors');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { errorHandler, timeoutHandler, withRetry, healthCheck } = require('./middleware/errorHandler');
const { correlationIdMiddleware, requestLoggingMiddleware, errorTrackingMiddleware } = require('./middleware/correlationId');
const { validateMatchRequest, validateSubmitResult, validateSubmitGuess } = require('./middleware/validation');
const { deduplicateRequests } = require('./middleware/deduplication');
const matchRoutes = require('./routes/matchRoutes');
const guessRoutes = require('./routes/guessRoutes');
const multisigRoutes = require('./routes/multisigRoutes');
const {
  getAllowedOrigins,
  isOriginAllowed,
  resolveCorsOrigin,
} = require('./config/corsOrigins');

const app = express();
app.set('etag', false);

// Trust proxy for rate limiting behind Render/Cloudflare
app.set('trust proxy', 1);

const allowedOrigins = getAllowedOrigins();
console.log('CORS allowed origins:', allowedOrigins);

// Security headers middleware
app.use((req: any, res: any, next: any) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Content Security Policy (CSP) - More permissive for debugging
  const cspDirective = process.env.NODE_ENV === 'development' 
    ? "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https: http: ws: wss:; " +
      "frame-src 'self' https://www.google.com;"
    : "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https://api.devnet.solana.com https://api.mainnet-beta.solana.com https://guess5.io https://www.guess5.io https://guess5.vercel.app https://guess5.onrender.com https://guess5-backend.onrender.com https://*.onrender.com; " +
      "frame-src 'self' https://www.google.com;";
  
  res.setHeader('Content-Security-Policy', cspDirective);
  
  next();
});

// Security middleware with reduced limits
// CRITICAL: Skip JSON parsing for application/octet-stream to allow raw body parsing
app.use(express.json({ 
  limit: '1mb',
  type: (req: any) => {
    // Only parse JSON content types, skip octet-stream
    const contentType = req.headers['content-type'] || '';
    return contentType.includes('application/json') && !contentType.includes('application/octet-stream');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Reduced from 10mb

// Apply CORS with restricted origins
app.use((req: any, res: any, next: any) => {
  // CRITICAL: Handle OPTIONS requests BEFORE CORS middleware to ensure they always get CORS headers
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    const corsOrigin = resolveCorsOrigin(origin);
    const originToUse = corsOrigin || 'https://guess5.io';
    
    res.header('Access-Control-Allow-Origin', originToUse);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With, x-recaptcha-token');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    console.log('✅ OPTIONS preflight handled early:', {
      url: req.url,
      origin: originToUse,
      requestedOrigin: origin
    });
    
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: function (origin: any, callback: any) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    // CRITICAL: Don't reject - let the manual CORS middleware handle it
    // This ensures headers are always set even if origin isn't in the list
    // The manual middleware will set the correct origin or default
    console.log('⚠️ Origin not in cors package list, but allowing (manual CORS will handle):', origin);
    callback(null, true); // Allow the request - manual CORS middleware will set correct headers
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma', 'Origin', 'X-Requested-With', 'x-recaptcha-token'],
  optionsSuccessStatus: 200
}));

// CRITICAL: Ensure CORS headers are ALWAYS set for all responses (including GET requests)
// This middleware runs AFTER the cors middleware to guarantee headers are present
app.use((req: any, res: any, next: any) => {
  // Only set CORS headers for actual requests (not OPTIONS, which are already handled)
  if (req.method !== 'OPTIONS') {
    const origin = req.headers.origin;
    const corsOrigin = resolveCorsOrigin(origin);
    const originToUse = corsOrigin || 'https://guess5.io';
    
    // Always set CORS headers for all responses
    res.header('Access-Control-Allow-Origin', originToUse);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Log for debugging
    if (req.url.includes('/api/match/status/')) {
      console.log('✅ CORS headers set for GET request:', {
        url: req.url,
        origin: origin,
        corsOrigin: corsOrigin,
        originToUse: originToUse
      });
    }
  }
  next();
});

// Handle preflight requests with explicit CORS headers
// CRITICAL: This must be registered BEFORE route-specific OPTIONS handlers
// to ensure it catches all OPTIONS requests that aren't handled by routes
app.options('*', (req: any, res: any) => {
  const origin = req.headers.origin;
  console.log('🔍 OPTIONS preflight request received:', {
    url: req.url,
    origin: origin,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  const corsOrigin = resolveCorsOrigin(origin);
  const originToUse = corsOrigin || 'https://guess5.io';
  
  res.header('Access-Control-Allow-Origin', originToUse);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With, x-recaptcha-token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
  
  console.log('✅ OPTIONS preflight response sent:', {
    url: req.url,
    origin: originToUse,
    allowedOrigin: originToUse
  });
  
  res.status(200).end();
});

// CRITICAL: Log POST /sign-proposal requests at Express level (expert recommendation)
// This catches requests before they enter handler logic, helping diagnose CORS/preflight issues
app.use((req: any, res: any, next: any) => {
  if (req.method === 'POST' && req.url.includes('sign-proposal')) {
    console.log('🔥 POST /sign-proposal received at middleware', {
      url: req.url,
      method: req.method,
      origin: req.headers.origin,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      timestamp: new Date().toISOString(),
    });
  }
  next();
});

// Apply correlation ID and logging middleware
app.use(correlationIdMiddleware);
app.use(requestLoggingMiddleware);

// Apply timeout handler for long-running operations
app.use(timeoutHandler(120000)); // 2 minute timeout for matchmaking operations

// Apply deduplication middleware
app.use(deduplicateRequests);



// IP-based fallback rate limiters (commented out)
// const ipMatchmakingLimiter = rateLimit({
//   windowMs: 30 * 1000,
//   max: 50,
//   message: { error: 'Too many matchmaking requests, please try again in 30 seconds' },
//   standardHeaders: true,
//   legacyHeaders: false,
//   skip: (req) => req.path === '/health'
// });

// const ipApiLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 50,
//   message: { error: 'Too many requests, please try again later' },
//   standardHeaders: true,
//   legacyHeaders: false,
//   skip: (req) => req.path === '/health'
// });

// Removed rate limiting - ReCaptcha provides sufficient protection
// app.use('/api/match/request-match', appWalletMatchmakingLimiter, ipMatchmakingLimiter);
// app.use('/api/match/check-match', appWalletMatchmakingLimiter, ipMatchmakingLimiter);
// app.use('/api/match/status', appWalletGameLimiter, ipApiLimiter);
// app.use('/api/', ipApiLimiter);

// Debug middleware to log requests (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req: any, res: any, next: any) => {
    console.log('🌐 Request Debug:', {
      method: req.method,
      origin: req.headers.origin,
      url: req.url,
      userAgent: req.headers['user-agent']
    });
    next();
  });
}

// CRITICAL: Global request logger to prove requests reach the backend
// This logs ALL requests BEFORE they hit route handlers
app.use((req: any, res: any, next: any) => {
  // Log ALL requests (especially POST to sign-proposal)
  console.log('🔥 REQ', {
    method: req.method,
    url: req.originalUrl || req.url,
    path: req.path,
    time: new Date().toISOString(),
    headers: {
      host: req.headers.host,
      origin: req.headers.origin,
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
    },
    query: req.query,
    note: 'If you see this for POST /api/match/sign-proposal, the request reached the backend',
  });
  
  // Special logging for sign-proposal requests
  if (req.method === 'POST' && (req.url.includes('/sign-proposal') || req.path.includes('/sign-proposal'))) {
    console.log('🔥 SIGN-PROPOSAL REQUEST DETECTED IN GLOBAL LOGGER', {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
      path: req.path,
      origin: req.headers.origin,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      query: req.query,
      note: 'This proves the request reached Express before route handlers',
    });
  }
  
  // Log all POST requests to /api/match/submit-result
  if (req.method === 'POST' && req.url.includes('/api/match/submit-result')) {
    console.log('📤 SUBMIT-RESULT REQUEST RECEIVED:', {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent'],
      contentType: req.headers['content-type'],
      hasReCaptchaToken: !!req.headers['x-recaptcha-token'],
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });
    
    // Additional logging for Player 2 requests
    if (req.body && req.body.wallet) {
      console.log('🔍 SUBMIT-RESULT WALLET:', req.body.wallet);
      console.log('🔍 SUBMIT-RESULT MATCH ID:', req.body.matchId);
      console.log('🔍 SUBMIT-RESULT BODY:', JSON.stringify(req.body, null, 2));
    }
  }
  next();
});

// Health check endpoint
app.get('/health', healthCheck);

// Test endpoint for CSP debugging
app.get('/api/test-csp', (req: any, res: any) => {
  console.log('🧪 CSP test endpoint called');
  res.json({ 
    success: true, 
    message: 'CSP test successful',
    timestamp: new Date().toISOString(),
    headers: {
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']
    }
  });
});

// Simple API test endpoint
app.get('/api/test', (req: any, res: any) => {
  console.log('🧪 API test endpoint called');
  res.json({ 
    success: true, 
    message: 'API connection successful',
    timestamp: new Date().toISOString(),
    apiUrl: process.env.NEXT_PUBLIC_API_URL || 'not set',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint - redirect to frontend
app.get('/', (req: any, res: any) => {
  res.redirect(process.env.FRONTEND_URL || 'https://guess5.vercel.app');
});

// API routes without rate limiting
app.use('/api/match', matchRoutes);
app.use('/api/guess', guessRoutes);
app.use('/api/multisig', multisigRoutes);
// Referral and admin routes (ES6 modules need .default when using require)
const referralRoutes = require('./routes/referralRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
app.use('/api/referral', referralRoutes.default || referralRoutes);
app.use('/api/admin', adminRoutes.default || adminRoutes);
app.use('/api/user', userRoutes.default || userRoutes);

// Debug endpoints only in development
if (process.env.NODE_ENV === 'development') {
  // Debug routes only in development
  app.get('/api/debug/status', (req: any, res: any) => {
    res.json({
      activeGames: require('./controllers/matchController').activeGames?.size || 0,
      matchmakingLocks: require('./controllers/matchController').matchmakingLocks?.size || 0,
      database: AppDataSource.isInitialized ? 'connected' : 'disconnected'
    });
  });
  
  // Debug matchmaking endpoint
  app.get('/api/debug/matchmaking', require('./controllers/matchController').debugMatchmakingHandler);
}

// 404 handler
app.use((req: any, res: any) => {
  res.status(404).json({ error: `Not found - ${req.originalUrl}` });
});

// Error tracking middleware
app.use(errorTrackingMiddleware);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;

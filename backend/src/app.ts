const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { errorHandler, notFound, asyncHandler } = require('./middleware/errorHandler');
const { validateMatchRequest, validateSubmitResult, validateSubmitGuess, validateEscrow } = require('./middleware/validation');
const { deduplicateRequests } = require('./middleware/deduplication');
const matchRoutes = require('./routes/matchRoutes');
const guessRoutes = require('./routes/guessRoutes');

const app = express();

// Use FRONTEND_URL from environment or default to localhost
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
console.log('CORS allowed origin:', allowedOrigin);

// Define allowed origins based on environment
const allowedOrigins = [
  'https://guess5.vercel.app',
  'https://guess5.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001'
];

// Add FRONTEND_URL to allowed origins if it's not already included
if (allowedOrigin && !allowedOrigins.includes(allowedOrigin)) {
  allowedOrigins.push(allowedOrigin);
}

// Security headers middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Content Security Policy (CSP)
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://api.devnet.solana.com https://api.mainnet-beta.solana.com https://guess5.vercel.app; " +
    "frame-src 'self' https://www.google.com;"
  );
  
  next();
});

// Security middleware with reduced limits
app.use(express.json({ limit: '1mb' })); // Reduced from 10mb
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Reduced from 10mb

// Apply CORS with restricted origins
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('🚫 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma', 'Origin', 'X-Requested-With', 'x-recaptcha-token'],
  optionsSuccessStatus: 200
}));

// Handle preflight requests with explicit CORS headers
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With, x-recaptcha-token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// Apply deduplication middleware
app.use(deduplicateRequests);

// Enhanced rate limiting configuration with wallet-based limits
const { createRateLimiter: createWalletRateLimiter } = require('./middleware/validation');

// Wallet-based rate limiters (very lenient for testing)
const appWalletMatchmakingLimiter = createWalletRateLimiter(30 * 1000, 500); // 500 requests per 30 seconds per wallet (very lenient)
const appWalletGameLimiter = createWalletRateLimiter(60 * 1000, 1000); // 1000 requests per minute per wallet (very lenient)
const appWalletResultLimiter = createWalletRateLimiter(60 * 1000, 200); // 200 result submissions per minute per wallet (very lenient)

// IP-based fallback rate limiters (for requests without wallet)
const ipMatchmakingLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 50, // Reduced from 100 for better security
  message: { error: 'Too many matchmaking requests, please try again in 30 seconds' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health'
});

const ipApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Reduced from 100 for better security
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health'
});

// Apply rate limiting to specific routes
app.use('/api/match/request-match', appWalletMatchmakingLimiter, ipMatchmakingLimiter);
app.use('/api/match/check-match', appWalletMatchmakingLimiter, ipMatchmakingLimiter);
app.use('/api/match/status', appWalletGameLimiter, ipApiLimiter);
app.use('/api/', ipApiLimiter);

// Debug middleware to log requests (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log('🌐 Request Debug:', {
      method: req.method,
      origin: req.headers.origin,
      url: req.url,
      userAgent: req.headers['user-agent']
    });
    next();
  });
}

// Health check endpoint
app.get('/health', asyncHandler(async (req, res) => {
  const { healthCheckHandler } = require('./utils/healthCheck');
  await healthCheckHandler(req, res);
}));

// Root endpoint - redirect to frontend
app.get('/', (req, res) => {
  res.redirect(process.env.FRONTEND_URL || 'https://guess5.vercel.app');
});

// API routes without rate limiting
app.use('/api/match', matchRoutes);
app.use('/api/guess', guessRoutes);

// Remove debug endpoints in production
if (process.env.NODE_ENV !== 'production') {
  // Debug routes only in development
  app.get('/api/debug/status', (req, res) => {
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
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;

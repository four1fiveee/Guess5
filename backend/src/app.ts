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
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma', 'Origin', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

// Handle preflight requests with explicit CORS headers
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// Apply deduplication middleware
app.use(deduplicateRequests);

// Rate limiting configuration
// More lenient for matchmaking to prevent stale matchmaking issues
const matchmakingLimiter = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 100, // Increased to 100 requests per 30 seconds for matchmaking
  message: { error: 'Too many matchmaking requests, please try again in 30 seconds' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Stricter rate limiting for other API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Allow 100 requests per 15 minutes for other endpoints
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Apply rate limiting to specific routes
app.use('/api/match/request-match', matchmakingLimiter);
app.use('/api/match/check-match', matchmakingLimiter);
app.use('/api/match/status', matchmakingLimiter);
app.use('/api/', apiLimiter);

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
}

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;

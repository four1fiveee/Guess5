const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { errorHandler, notFound, asyncHandler } = require('./middleware/errorHandler');
const { validateMatchRequest, validateSubmitResult, validateSubmitGuess, validateEscrow, createRateLimiter } = require('./middleware/validation');
const matchRoutes = require('./routes/matchRoutes');
const guessRoutes = require('./routes/guessRoutes');

const app = express();

// Use FRONTEND_URL from environment or default to localhost
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
console.log('CORS allowed origin:', allowedOrigin);

// Security middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting configuration
const globalLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10000, // 10000 requests per 15 minutes (very permissive)
  (req) => req.ip
);

const matchmakingLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10000, // 10000 matchmaking requests per 15 minutes (very permissive)
  (req) => req.body.wallet || req.ip
);

const gameLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10000, // 10000 game actions per 15 minutes (very permissive)
  (req) => req.body.wallet || req.ip
);

// Apply CORS first (before rate limiting)
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma', 'Origin', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

// Handle preflight requests with explicit CORS headers
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// Apply rate limiting after CORS
app.use(globalLimiter);

// Debug middleware to log CORS requests (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log('🌐 CORS Debug:', {
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

// API routes with validation and rate limiting
app.use('/api/match', matchmakingLimiter, matchRoutes);
app.use('/api/guess', gameLimiter, guessRoutes);

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

// Initialize database synchronously before starting server
let dbConnected = false;
if (process.env.DATABASE_URL) {
  console.log('🔌 Database initialization will happen during server startup');
} else {
  console.log('No DATABASE_URL provided, running without database');
}

// Export for use in other files
app.dbConnected = dbConnected;

module.exports = app;

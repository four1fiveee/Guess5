const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, AppDataSource } = require('./db/index');
const matchRoutes = require('./routes/matchRoutes');
const guessRoutes = require('./routes/guessRoutes');

const app = express();

// Use FRONTEND_URL from environment or default to localhost
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
console.log('CORS allowed origin:', allowedOrigin);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased from 100 to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and OPTIONS requests
    return req.path === '/health' || req.method === 'OPTIONS';
  }
});

// Apply rate limiting to all routes
app.use(limiter);

// Debug middleware to log CORS requests
app.use((req, res, next) => {
  console.log('🌐 CORS Debug:', {
    method: req.method,
    origin: req.headers.origin,
    url: req.url,
    userAgent: req.headers['user-agent']
  });
  next();
});

// CORS configuration - allow all origins
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://guess5.vercel.app',
      'http://localhost:3000', 
      'https://localhost:3000',
      'http://localhost:3001',
      'https://localhost:3001'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('🚫 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma'],
  optionsSuccessStatus: 200
}));

app.use(express.json());

// Handle preflight requests with explicit CORS headers
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Pragma');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// Health check endpoint
app.get('/health', (req: any, res: any) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: AppDataSource.isInitialized ? 'connected' : 'disconnected'
  });
});

// API routes
app.use('/api/match', matchRoutes);
app.use('/api/guess', guessRoutes);

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

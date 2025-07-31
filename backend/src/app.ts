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
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
app.use(limiter);

// CORS configuration - allow both localhost and Vercel
const allowedOrigins = [
  'http://localhost:3000',
  'https://guess5.vercel.app',
  allowedOrigin
].filter(Boolean); // Remove any undefined values

console.log('CORS allowed origins:', allowedOrigins);

// CORS configuration - allow all origins
app.use(cors({
  origin: ['http://localhost:3000', 'https://guess5.vercel.app', 'https://guess5.vercel.app/'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma'],
  optionsSuccessStatus: 200
}));

app.use(express.json());

// Handle preflight requests
app.options('*', cors());

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

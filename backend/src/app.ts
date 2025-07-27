const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, AppDataSource } = require('./db/index');
const matchRoutes = require('./routes/matchRoutes');
const guessRoutes = require('./routes/guessRoutes');

const app = express();

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

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

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

// Initialize database
let dbConnected = false;
if (process.env.DATABASE_URL) {
  initializeDatabase()
    .then(() => {
      dbConnected = true;
      console.log('✅ Database connected successfully');
    })
    .catch((error: any) => {
      console.error('❌ Database connection failed:', error);
      console.log('⚠️ Running without database - using in-memory storage');
    });
} else {
  console.log('No DATABASE_URL provided, running without database');
}

// Export for use in other files
app.dbConnected = dbConnected;

module.exports = app; 
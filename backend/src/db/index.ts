import { DataSource } from 'typeorm'
import { Match } from '../models/Match'
import { Guess } from '../models/Guess'
import { Transaction } from '../models/Transaction'

// Validate required environment variables
const validateDatabaseConfig = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  
  console.log('✅ Database configuration validated');
};

// Validate environment variables before creating DataSource
validateDatabaseConfig();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL!,
  entities: [Match, Guess, Transaction],
  migrations: ['dist/db/migrations/*.js'],
  synchronize: false, // Use migrations instead of synchronize
  logging: process.env.NODE_ENV === 'development',
  extra: {
    ssl: {
      rejectUnauthorized: false
    }
  },
  // Performance optimizations for production
  ...(process.env.NODE_ENV === 'production' && {
    maxQueryExecutionTime: 5000, // 5 second timeout
    connectTimeoutMS: 10000, // 10 second connection timeout
    poolSize: 10, // Connection pool size
    acquireTimeout: 60000, // 60 second acquire timeout
    timeout: 60000, // 60 second query timeout
    // Connection resilience settings
    retryAttempts: 3,
    retryDelay: 1000,
    keepConnectionAlive: true,
    // Connection pool settings
    max: 20, // Maximum number of connections
    min: 5,  // Minimum number of connections
    idle: 10000, // Close idle connections after 10 seconds
    acquire: 60000, // Acquire timeout
  })
})

// Database connection health check
export const checkDatabaseHealth = async () => {
  try {
    if (!AppDataSource.isInitialized) {
      return { healthy: false, error: 'Database not initialized' };
    }
    
    // Test query to verify connection
    await AppDataSource.query('SELECT 1');
    return { healthy: true };
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return { healthy: false, error: error.message };
  }
};

// Reconnection logic
export const reconnectDatabase = async () => {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    
    console.log('🔄 Attempting to reconnect to database...');
    await AppDataSource.initialize();
    console.log('✅ Database reconnected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database reconnection failed:', error);
    return false;
  }
};

// Initialize database connection with retry logic
export const initializeDatabase = async () => {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      console.log(`🔌 Initializing database connection (attempt ${retryCount + 1}/${maxRetries})...`);
      await AppDataSource.initialize();
      console.log('✅ Database connected successfully');
      
      // Run migrations
      await AppDataSource.runMigrations();
      console.log('✅ Database migrations completed');
      
      // Set up connection monitoring
      if (process.env.NODE_ENV === 'production') {
        setInterval(async () => {
          const health = await checkDatabaseHealth();
          if (!health.healthy) {
            console.warn('⚠️ Database health check failed, attempting reconnection...');
            await reconnectDatabase();
          }
        }, 30000); // Check every 30 seconds
      }
      
      return;
    } catch (error) {
      console.error(`❌ Database connection attempt ${retryCount + 1} failed:`, error);
      retryCount++;
      
      if (retryCount < maxRetries) {
        console.log(`⏳ Retrying in ${retryCount * 2000}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
      } else {
        console.error('❌ Database connection failed after all retries');
        throw error;
      }
    }
  }
} 
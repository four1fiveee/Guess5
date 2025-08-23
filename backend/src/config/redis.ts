import Redis from 'ioredis';
import { enhancedLogger } from '../utils/enhancedLogger';

// Redis connection configurations
const redisMMConfig = {
  host: process.env.REDIS_MM_HOST || 'localhost',
  port: parseInt(process.env.REDIS_MM_PORT || '6379'),
  username: process.env.REDIS_MM_USER || 'default',
  password: process.env.REDIS_MM_PASSWORD || '',
  db: parseInt(process.env.REDIS_MM_DB || '0'),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: false, // Changed to false for immediate connection
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
  tls: process.env.REDIS_MM_TLS === 'true' ? {
    rejectUnauthorized: false // Allow self-signed certificates
  } : undefined,
};

const redisOpsConfig = {
  host: process.env.REDIS_OPS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_OPS_PORT || '6379'),
  username: process.env.REDIS_OPS_USER || 'default',
  password: process.env.REDIS_OPS_PASSWORD || '',
  db: parseInt(process.env.REDIS_OPS_DB || '1'),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: false, // Changed to false for immediate connection
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
  tls: process.env.REDIS_OPS_TLS === 'true' ? {
    rejectUnauthorized: false // Allow self-signed certificates
  } : undefined,
};

// Redis client instances
let redisMM: Redis | null = null;
let redisOps: Redis | null = null;

// Initialize Redis connections
export const initializeRedis = async (): Promise<void> => {
  try {
    enhancedLogger.info('🔧 Initializing Redis connections...', {
      mmHost: process.env.REDIS_MM_HOST,
      mmPort: process.env.REDIS_MM_PORT,
      mmUser: process.env.REDIS_MM_USER ? '***' : undefined,
      mmTls: process.env.REDIS_MM_TLS,
      opsHost: process.env.REDIS_OPS_HOST,
      opsPort: process.env.REDIS_OPS_PORT,
      opsUser: process.env.REDIS_OPS_USER ? '***' : undefined,
      opsTls: process.env.REDIS_OPS_TLS
    });

    // Initialize matchmaking Redis
    redisMM = new Redis(redisMMConfig);
    
    redisMM.on('connect', () => {
      enhancedLogger.info('🔌 Connected to Redis MM (matchmaking)');
    });
    
    redisMM.on('ready', () => {
      enhancedLogger.info('✅ Redis MM ready');
    });
    
    redisMM.on('error', (error) => {
      enhancedLogger.error('❌ Redis MM connection error:', error);
    });
    
    redisMM.on('close', () => {
      enhancedLogger.warn('⚠️ Redis MM connection closed');
    });

    // Initialize operations Redis
    redisOps = new Redis(redisOpsConfig);
    
    redisOps.on('connect', () => {
      enhancedLogger.info('🔌 Connected to Redis Ops (queues/jobs)');
    });
    
    redisOps.on('ready', () => {
      enhancedLogger.info('✅ Redis Ops ready');
    });
    
    redisOps.on('error', (error) => {
      enhancedLogger.error('❌ Redis Ops connection error:', error);
    });
    
    redisOps.on('close', () => {
      enhancedLogger.warn('⚠️ Redis Ops connection closed');
    });

    // Test connections
    enhancedLogger.info('🧪 Testing Redis connections...');
    await redisMM.ping();
    enhancedLogger.info('✅ Redis MM ping successful');
    await redisOps.ping();
    enhancedLogger.info('✅ Redis Ops ping successful');
    
    enhancedLogger.info('✅ Redis connections initialized successfully');
  } catch (error) {
    enhancedLogger.error('❌ Failed to initialize Redis connections:', error);
    throw error;
  }
};

// Get Redis clients
export const getRedisMM = (): Redis => {
  if (!redisMM) {
    throw new Error('Redis MM not initialized. Call initializeRedis() first.');
  }
  return redisMM;
};

export const getRedisOps = (): Redis => {
  if (!redisOps) {
    throw new Error('Redis Ops not initialized. Call initializeRedis() first.');
  }
  return redisOps;
};

// Close Redis connections
export const closeRedis = async (): Promise<void> => {
  try {
    if (redisMM) {
      await redisMM.quit();
      enhancedLogger.info('🔌 Redis MM connection closed');
    }
    if (redisOps) {
      await redisOps.quit();
      enhancedLogger.info('🔌 Redis Ops connection closed');
    }
  } catch (error) {
    enhancedLogger.error('❌ Error closing Redis connections:', error);
  }
};

// Health check for Redis
export const checkRedisHealth = async (): Promise<{ mm: boolean; ops: boolean }> => {
  const health = { mm: false, ops: false };
  
  try {
    if (redisMM) {
      await redisMM.ping();
      health.mm = true;
    }
  } catch (error) {
    enhancedLogger.error('❌ Redis MM health check failed:', error);
  }
  
  try {
    if (redisOps) {
      await redisOps.ping();
      health.ops = true;
    }
  } catch (error) {
    enhancedLogger.error('❌ Redis Ops health check failed:', error);
  }
  
  return health;
};

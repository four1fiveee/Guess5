import { createClient } from 'redis';
import Redis from 'ioredis';
import { enhancedLogger } from '../utils/enhancedLogger';

// Redis Cloud connection configurations using redis package with TLS
const redisMMConfig = {
  username: process.env.REDIS_MM_USER || 'default',
  password: process.env.REDIS_MM_PASSWORD || '',
  socket: {
    host: process.env.REDIS_MM_HOST || 'localhost',
    port: parseInt(process.env.REDIS_MM_PORT || '6379'),
    tls: process.env.REDIS_MM_TLS === 'true',
    rejectUnauthorized: false // Allow self-signed certificates for Redis Cloud
  }
};

const redisOpsConfig = {
  username: process.env.REDIS_OPS_USER || 'default',
  password: process.env.REDIS_OPS_PASSWORD || '',
  socket: {
    host: process.env.REDIS_OPS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_OPS_PORT || '6379'),
    tls: process.env.REDIS_OPS_TLS === 'true',
    rejectUnauthorized: false // Allow self-signed certificates for Redis Cloud
  }
};

// ioredis config for BullMQ compatibility - Enhanced for 1000 concurrent users
const ioredisMMConfig = {
  host: process.env.REDIS_MM_HOST || 'localhost',
  port: parseInt(process.env.REDIS_MM_PORT || '6379'),
  username: process.env.REDIS_MM_USER || 'default',
  password: process.env.REDIS_MM_PASSWORD || '',
  db: 0,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 5, // Increased from 3
  lazyConnect: false,
  keepAlive: 30000,
  connectTimeout: 15000, // Increased from 10000
  commandTimeout: 10000, // Increased from 5000
  // Connection pool settings for high concurrency
  enableReadyCheck: true,
  maxLoadingTimeout: 10000,
  // Connection resilience
  reconnectOnError: (err: any) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
  tls: process.env.REDIS_MM_TLS === 'true' ? {
    rejectUnauthorized: false
  } : undefined,
};

const ioredisOpsConfig = {
  host: process.env.REDIS_OPS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_OPS_PORT || '6379'),
  username: process.env.REDIS_OPS_USER || 'default',
  password: process.env.REDIS_OPS_PASSWORD || '',
  db: parseInt(process.env.REDIS_OPS_DB || '0'),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 5, // Increased from 3
  lazyConnect: false,
  keepAlive: 30000,
  connectTimeout: 15000, // Increased from 10000
  commandTimeout: 10000, // Increased from 5000
  // Connection pool settings for high concurrency
  enableReadyCheck: true,
  maxLoadingTimeout: 10000,
  // Connection resilience
  reconnectOnError: (err: any) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
  tls: process.env.REDIS_OPS_TLS === 'true' ? {
    rejectUnauthorized: false
  } : undefined,
};

// Redis client instances
let redisMM: ReturnType<typeof createClient> | null = null;
let redisOps: ReturnType<typeof createClient> | null = null;
let ioredisMM: Redis | null = null;
let ioredisOps: Redis | null = null;

// Initialize Redis connections
export const initializeRedis = async (): Promise<void> => {
  try {
    enhancedLogger.info('🔧 Initializing Redis Cloud connections...', {
      mmHost: process.env.REDIS_MM_HOST,
      mmPort: process.env.REDIS_MM_PORT,
      mmUser: process.env.REDIS_MM_USER ? '***' : undefined,
      mmTls: process.env.REDIS_MM_TLS,
      opsHost: process.env.REDIS_OPS_HOST,
      opsPort: process.env.REDIS_OPS_PORT,
      opsUser: process.env.REDIS_OPS_USER ? '***' : undefined,
      opsTls: process.env.REDIS_OPS_TLS
    });

    // Initialize matchmaking Redis (redis package)
    redisMM = createClient(redisMMConfig);
    
    redisMM.on('connect', () => {
      enhancedLogger.info('🔌 Connected to Redis MM (matchmaking)');
    });
    
    redisMM.on('ready', () => {
      enhancedLogger.info('✅ Redis MM ready');
    });
    
    redisMM.on('error', (error: any) => {
      enhancedLogger.error('❌ Redis MM connection error:', error);
    });
    
    redisMM.on('close', () => {
      enhancedLogger.warn('⚠️ Redis MM connection closed');
    });

    // Initialize operations Redis (redis package)
    redisOps = createClient(redisOpsConfig);
    
    redisOps.on('connect', () => {
      enhancedLogger.info('🔌 Connected to Redis Ops (queues/jobs)');
    });
    
    redisOps.on('ready', () => {
      enhancedLogger.info('✅ Redis Ops ready');
    });
    
    redisOps.on('error', (error: any) => {
      enhancedLogger.error('❌ Redis Ops connection error:', error);
    });
    
    redisOps.on('close', () => {
      enhancedLogger.warn('⚠️ Redis Ops connection closed');
    });

    // Initialize ioredis instances for BullMQ compatibility
    ioredisMM = new Redis(ioredisMMConfig);
    ioredisOps = new Redis(ioredisOpsConfig);

    // Connect to both Redis instances
    enhancedLogger.info('🔌 Connecting to Redis instances...');
    await redisMM.connect();
    await redisOps.connect();

    // Test connections
    enhancedLogger.info('🧪 Testing Redis connections...');
    await redisMM.ping();
    enhancedLogger.info('✅ Redis MM ping successful');
    await redisOps.ping();
    enhancedLogger.info('✅ Redis Ops ping successful');
    
    enhancedLogger.info('✅ Redis connections initialized successfully');
  } catch (error: unknown) {
    enhancedLogger.error('❌ Failed to initialize Redis connections:', error);
    throw error;
  }
};

// Get Redis clients (redis package)
export const getRedisMM = (): ReturnType<typeof createClient> => {
  if (!redisMM) {
    throw new Error('Redis MM not initialized. Call initializeRedis() first.');
  }
  return redisMM;
};

export const getRedisOps = (): ReturnType<typeof createClient> => {
  if (!redisOps) {
    throw new Error('Redis Ops not initialized. Call initializeRedis() first.');
  }
  return redisOps;
};

// Get ioredis clients for BullMQ
export const getIoredisMM = (): Redis => {
  if (!ioredisMM) {
    throw new Error('ioredis MM not initialized. Call initializeRedis() first.');
  }
  return ioredisMM;
};

export const getIoredisOps = (): Redis => {
  if (!ioredisOps) {
    throw new Error('ioredis Ops not initialized. Call initializeRedis() first.');
  }
  return ioredisOps;
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
    if (ioredisMM) {
      await ioredisMM.quit();
      enhancedLogger.info('🔌 ioredis MM connection closed');
    }
    if (ioredisOps) {
      await ioredisOps.quit();
      enhancedLogger.info('🔌 ioredis Ops connection closed');
    }
  } catch (error: unknown) {
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
  } catch (error: unknown) {
    enhancedLogger.error('❌ Redis MM health check failed:', error);
  }
  
  try {
    if (redisOps) {
      await redisOps.ping();
      health.ops = true;
    }
  } catch (error: unknown) {
    enhancedLogger.error('❌ Redis Ops health check failed:', error);
  }
  
  return health;
};

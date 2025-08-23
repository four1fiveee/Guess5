import { AppDataSource } from '../db/index';
import { logger } from './logger';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  checks: {
    database: boolean;
    memory: boolean;
    uptime: number;
    activeGames: number;
    matchmakingLocks: number;
    redis: boolean; // Added Redis check
  };
  details?: any;
}

export class HealthChecker {
  private startTime = Date.now();

  async checkDatabase(): Promise<boolean> {
    try {
      if (!AppDataSource.isInitialized) {
        return false;
      }
      
      // Test database connection with a simple query
      const queryRunner = AppDataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query('SELECT 1');
      await queryRunner.release();
      
      return true;
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return false;
    }
  }

  checkMemory(): boolean {
    const used = process.memoryUsage();
    const maxHeap = 512 * 1024 * 1024; // 512MB limit
    
    // Check if memory usage is reasonable
    return used.heapUsed < maxHeap;
  }

  async checkRedis(): Promise<boolean> {
    try {
      const { checkRedisHealth } = require('../config/redis');
      const health = await checkRedisHealth();
      return health.mm && health.ops;
    } catch (error) {
      console.error('❌ Redis health check failed:', error);
      return false;
    }
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const database = await this.checkDatabase();
    const memory = this.checkMemory();
    const redis = await this.checkRedis();
    const uptime = this.getUptime();

    // Get game state metrics
    const { activeGames, matchmakingLocks } = require('../controllers/matchController');
    const activeGamesCount = activeGames?.size || 0;
    const locksCount = matchmakingLocks?.size || 0;

    const checks = {
      database,
      memory,
      redis,
      uptime,
      activeGames: activeGamesCount,
      matchmakingLocks: locksCount
    };

    // Determine overall status
    let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    
    if (!database || !memory) {
      status = 'unhealthy';
    } else if (!redis) {
      status = 'degraded'; // Redis is optional for now
    } else if (activeGamesCount > 1000 || locksCount > 100) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      checks,
      details: {
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV
      }
    };
  }

  // Detailed health check for monitoring
  async getDetailedHealth(): Promise<any> {
    const health = await this.getHealthStatus();
    
    // Add additional metrics
    const additionalMetrics = {
      processId: process.pid,
      platform: process.platform,
      arch: process.arch,
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL ? 'configured' : 'missing',
      solanaNetwork: process.env.SOLANA_NETWORK || 'devnet',
      programId: process.env.PROGRAM_ID ? 'configured' : 'missing'
    };

    return {
      ...health,
      metrics: additionalMetrics
    };
  }
}

// Export singleton instance
export const healthChecker = new HealthChecker();

// Health check endpoint handler
export const healthCheckHandler = async (req: any, res: any) => {
  try {
    const health = await healthChecker.getHealthStatus();
    
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
}; 
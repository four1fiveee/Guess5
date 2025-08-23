import "reflect-metadata";
const app = require('./app');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { validateSolanaConfig } = require('./config/wallet');
const { validateConfig, config } = require('./config/environment');
const { createServer } = require('http');
const { websocketService } = require('./services/websocketService');
const { initializeRedis, closeRedis, checkRedisHealth } = require('./config/redis');
const { queueService } = require('./services/queueService');
const { redisMatchmakingService } = require('./services/redisMatchmakingService');
const { enhancedLogger } = require('./utils/enhancedLogger');

// Initialize database and Redis before starting server
async function startServer() {
  try {
    // Validate environment variables first
    enhancedLogger.info('🔍 Validating environment configuration...');
    validateConfig();
    enhancedLogger.info('✅ Environment configuration validated');

    // Validate Solana configuration
    enhancedLogger.info('🔍 Validating Solana configuration...');
    validateSolanaConfig();
    enhancedLogger.info('✅ Solana configuration validated');

    enhancedLogger.info('🔌 Initializing database connection...');
    await initializeDatabase();
    enhancedLogger.info('✅ Database connected successfully');

    // Temporarily disable Redis to get the app running
    enhancedLogger.info('⚠️ Redis initialization temporarily disabled for troubleshooting');
    /*
    enhancedLogger.info('🔌 Initializing Redis connections...');
    await initializeRedis();
    enhancedLogger.info('✅ Redis initialized successfully');

    // Start cleanup scheduler for Redis matchmaking
    setInterval(async () => {
      try {
        await redisMatchmakingService.cleanup();
      } catch (error) {
        enhancedLogger.error('❌ Error during Redis cleanup:', error);
      }
    }, 60000); // Run cleanup every minute
    */

    // Create HTTP server for WebSocket support
    const server = createServer(app);

    // Initialize WebSocket service
    enhancedLogger.info('🔌 Initializing WebSocket service...');
    websocketService.initialize(server);
    enhancedLogger.info('✅ WebSocket service initialized');

    // Start server after database and Redis are ready
    const port = config.server.port;
    server.listen(port, () => {
      enhancedLogger.info(`🚀 Server running on port ${port}`);
      enhancedLogger.info(`🌐 Health check: http://localhost:${port}/health`);
      enhancedLogger.info(`🔌 WebSocket endpoint: ws://localhost:${port}/ws`);
      enhancedLogger.info(`🎮 Ready for multiplayer matchmaking!`);
      enhancedLogger.info(`🎯 Security configuration:`);
      enhancedLogger.info(`   - Environment: ${config.security.nodeEnv}`);
      enhancedLogger.info(`   - ReCaptcha: ${config.security.recaptchaSecret ? 'Enabled' : 'Disabled'}`);
      enhancedLogger.info(`   - Memory limits: ${config.limits.maxActiveGames} active games`);
      enhancedLogger.info(`   - WebSocket: Enabled with real-time events`);
      enhancedLogger.info(`   - Redis: Temporarily disabled for troubleshooting`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      enhancedLogger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);
      try {
        // Temporarily disabled Redis cleanup
        // await closeRedis();
        // enhancedLogger.info('🔌 Redis connections closed');
        // await queueService.close();
        // enhancedLogger.info('🔌 Queue service closed');
        server.close(() => {
          enhancedLogger.info('🔌 HTTP server closed');
          process.exit(0);
        });
        setTimeout(() => {
          enhancedLogger.error('❌ Forced shutdown after timeout');
          process.exit(1);
        }, 10000);
      } catch (error) {
        enhancedLogger.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    enhancedLogger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}
startServer(); 
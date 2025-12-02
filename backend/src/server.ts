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
  let server: any = null;
  
  try {
    // Validate environment variables first
    enhancedLogger.info('🔍 Validating environment configuration...');
    validateConfig();
    enhancedLogger.info('✅ Environment configuration validated');

    // Validate Solana configuration
    enhancedLogger.info('🔍 Validating Solana configuration...');
    validateSolanaConfig();
    enhancedLogger.info('✅ Solana configuration validated');

    // NOTE: Vault transactions do NOT require approval in Squads v4
    // Only Proposals require signatures. VaultTransaction automatically becomes ExecuteReady
    // when the linked Proposal reaches ExecuteReady.
    // IDL initialization for vault transaction approval is no longer needed.

    enhancedLogger.info('🔌 Initializing database connection...');
    await initializeDatabase();
    enhancedLogger.info('✅ Database connected successfully');

    // CRITICAL: Make Redis initialization non-blocking with timeout
    // Server must bind to port even if Redis fails
    enhancedLogger.info('🔌 Initializing Redis connections...');
    try {
      const redisInitPromise = initializeRedis();
      const redisTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Redis initialization timeout (10s)')), 10000);
      });
      await Promise.race([redisInitPromise, redisTimeoutPromise]);
      enhancedLogger.info('✅ Redis initialized successfully');
    } catch (error: any) {
      enhancedLogger.warn(`⚠️ Redis initialization failed or timed out (continuing without Redis):`, error?.message || error);
      enhancedLogger.warn('⚠️ Server will start in degraded mode - some features may be unavailable');
    }
    
    // Initialize Redis lock auto-cleanup after Redis is ready (optional)
    try {
      const { initializeAutoCleanup } = require('./utils/proposalLocks');
      initializeAutoCleanup();
      enhancedLogger.info('✅ Redis lock auto-cleanup initialized');
    } catch (error: any) {
      enhancedLogger.warn('⚠️ Redis lock auto-cleanup failed (optional):', error?.message || error);
    }

    // Smart contract service is optional - matchmaking uses Squads Protocol
    // Only initialize if the file exists (it's not required for basic matchmaking)
    enhancedLogger.info('🔌 Checking for smart contract service (optional)...');
    try {
      // Try to load smart contract service if it exists
      try {
        const smartContractModule = require('./services/smartContractService');
        if (smartContractModule && smartContractModule.getSmartContractService) {
          const smartContractService = smartContractModule.getSmartContractService();
          enhancedLogger.info('✅ Smart contract service loaded (optional feature)');
        }
      } catch (moduleError) {
        // Module doesn't exist or isn't available - that's fine for matchmaking
        enhancedLogger.info('ℹ️ Smart contract service not available (optional - matchmaking uses Squads Protocol)');
      }
    } catch (error) {
      // Silent fail - smart contract is optional
      enhancedLogger.info('ℹ️ Smart contract features not available - matchmaking will use Squads Protocol');
    }

    // Start cleanup scheduler for Redis matchmaking (optional)
    try {
      setInterval(async () => {
        try {
          await redisMatchmakingService.cleanup();
        } catch (error) {
          enhancedLogger.error('❌ Error during Redis cleanup:', error);
        }
      }, 60000); // Run cleanup every minute
    } catch (error: any) {
      enhancedLogger.warn('⚠️ Failed to start Redis cleanup scheduler (optional):', error?.message || error);
    }

    // Start proposal expiration scanner (optional)
    try {
      const { proposalExpirationService } = require('./services/proposalExpirationService');
      setInterval(async () => {
        try {
          await proposalExpirationService.scanForExpiredProposals();
        } catch (error) {
          enhancedLogger.error('❌ Error during proposal expiration scan:', error);
        }
      }, 5 * 60 * 1000); // Scan every 5 minutes
      enhancedLogger.info('✅ Proposal expiration scanner started');
    } catch (error: any) {
      enhancedLogger.warn('⚠️ Failed to start proposal expiration scanner (optional):', error?.message || error);
    }

    // CRITICAL: Create and bind server EARLY to ensure Render detects the port
    // This must happen before any optional services that might hang
    server = createServer(app);
    
    // CRITICAL: Ensure port is a number (Render provides PORT as string)
    const port = parseInt(String(config.server.port), 10) || 4000;
    
    if (!port || isNaN(port)) {
      enhancedLogger.error(`❌ Invalid port configuration: ${config.server.port}`);
      process.exit(1);
    }
    
    enhancedLogger.info(`🔌 Binding server to port ${port} (early binding for Render)...`);
    
    // Bind server immediately - don't wait for optional services
    // CRITICAL: This must happen early so Render can detect the port
    server.listen(port, '0.0.0.0', () => {
      enhancedLogger.info(`🚀 Server bound to port ${port} - Render can now detect the port`);
      enhancedLogger.info(`🚀 Server running on port ${port}`);
      enhancedLogger.info(`🌐 Health check: http://localhost:${port}/health`);
      enhancedLogger.info(`🔌 WebSocket endpoint: ws://localhost:${port}/ws`);
      enhancedLogger.info(`🎮 Ready for multiplayer matchmaking!`);
      enhancedLogger.info(`🎯 Security configuration:`);
      enhancedLogger.info(`   - Environment: ${config.security.nodeEnv}`);
      enhancedLogger.info(`   - ReCaptcha: ${config.security.recaptchaSecret ? 'Enabled' : 'Disabled'}`);
      enhancedLogger.info(`   - Memory limits: ${config.limits.maxActiveGames} active games`);
      enhancedLogger.info(`   - WebSocket: Enabled with real-time events`);
      enhancedLogger.info(`   - Redis: ${process.env.REDIS_MM_HOST ? 'Enabled' : 'Disabled'} (MM: ${process.env.REDIS_MM_HOST || 'N/A'}, Ops: ${process.env.REDIS_OPS_HOST || 'N/A'})`);

      // Initialize WebSocket service (optional - server is already bound)
      try {
        enhancedLogger.info('🔌 Initializing WebSocket service...');
        websocketService.initialize(server);
        enhancedLogger.info('✅ WebSocket service initialized');
      } catch (error: any) {
        enhancedLogger.warn('⚠️ WebSocket initialization failed (optional):', error?.message || error);
      }

      // Start cron jobs (optional)
      try {
        const { CronService } = require('./services/cronService');
        CronService.start();
        enhancedLogger.info('✅ Cron jobs started');
      } catch (error: any) {
        enhancedLogger.warn('⚠️ Failed to start cron jobs (optional):', error?.message || error);
      }

      // CRITICAL FIX: Start proposal execution services (optional)
      try {
        const { executionRetryService } = require('./services/executionRetryService');
        const { proposalOnChainSyncService } = require('./services/proposalOnChainSyncService');
        
        executionRetryService.start();
        proposalOnChainSyncService.start();
        
        enhancedLogger.info('✅ Proposal execution services started');
      } catch (error: any) {
        enhancedLogger.warn('⚠️ Failed to start proposal execution services (optional):', error?.message || error);
      }
    });
    
    // CRITICAL: Handle server listen errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        enhancedLogger.error(`❌ Port ${port} is already in use`);
      } else {
        enhancedLogger.error(`❌ Server error:`, error);
      }
      process.exit(1);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      enhancedLogger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);
      try {
        // Stop Redis lock auto-cleanup
        const { stopAutoCleanup } = require('./utils/proposalLocks');
        stopAutoCleanup();
        
        // Stop cron jobs
        try {
          const { CronService } = require('./services/cronService');
          CronService.stop();
          enhancedLogger.info('✅ Cron jobs stopped');
        } catch (error) {
          enhancedLogger.warn('⚠️ Failed to stop cron jobs:', error);
        }
        
        // Stop proposal execution services
        try {
          const { executionRetryService } = require('./services/executionRetryService');
          const { proposalOnChainSyncService } = require('./services/proposalOnChainSyncService');
          
          executionRetryService.stop();
          proposalOnChainSyncService.stop();
          
          enhancedLogger.info('✅ Proposal execution services stopped');
        } catch (error) {
          enhancedLogger.warn('⚠️ Failed to stop proposal execution services:', error);
        }
        
        await closeRedis();
        enhancedLogger.info('🔌 Redis connections closed');
        await queueService.close();
        enhancedLogger.info('🔌 Queue service closed');
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
    
    // CRITICAL: Even if initialization fails, try to start server on a port
    // This ensures Render can detect the port binding
    if (!server) {
      server = createServer((req: any, res: any) => {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Service temporarily unavailable - initialization failed' }));
      });
    }
    
    const port = parseInt(String(process.env.PORT || 4000), 10);
    enhancedLogger.error(`⚠️ Starting server in degraded mode on port ${port} due to initialization failure`);
    
    server.listen(port, '0.0.0.0', () => {
      enhancedLogger.info(`🚀 Server running in degraded mode on port ${port}`);
    });
    
    server.on('error', (err: any) => {
      enhancedLogger.error('❌ Server error:', err);
      process.exit(1);
    });
    
    // Don't exit - let the server run so Render can detect the port
    // process.exit(1);
  }
}
startServer(); 
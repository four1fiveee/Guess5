import "reflect-metadata";
const app = require('./app');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { validateSolanaConfig } = require('./config/wallet');
const { validateConfig, config } = require('./config/environment');
const { createServer } = require('http');
const { websocketService } = require('./services/websocketService');

// Initialize database before starting server
async function startServer() {
  try {
    // Validate environment variables first
    console.log('🔍 Validating environment configuration...');
    validateConfig();
    console.log('✅ Environment configuration validated');
    
    // Validate Solana configuration
    console.log('🔍 Validating Solana configuration...');
    validateSolanaConfig();
    console.log('✅ Solana configuration validated');
    
    console.log('🔌 Initializing database connection...');
    await initializeDatabase();
    console.log('✅ Database connected successfully');
    
    // Create HTTP server for WebSocket support
    const server = createServer(app);
    
    // Initialize WebSocket service
    console.log('🔌 Initializing WebSocket service...');
    websocketService.initialize(server);
    console.log('✅ WebSocket service initialized');
    
    // Start server after database is ready
    const port = config.server.port;
    server.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🌐 Health check: http://localhost:${port}/health`);
      console.log(`🔌 WebSocket endpoint: ws://localhost:${port}/ws`);
      console.log(`🎮 Ready for multiplayer matchmaking!`);
      console.log(`🎯 Security configuration:`);
      console.log(`   - Environment: ${config.security.nodeEnv}`);
      console.log(`   - ReCaptcha: ${config.security.recaptchaSecret ? 'Enabled' : 'Disabled'}`);
      console.log(`   - Memory limits: ${config.limits.maxActiveGames} active games`);
      console.log(`   - WebSocket: Enabled with real-time events`);
    });
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Try to start server anyway for debugging
    try {
      const port = config.server.port || 40000;
      const server = createServer(app);
      
      // Initialize WebSocket service even with errors
      console.log('🔌 Initializing WebSocket service (with errors)...');
      websocketService.initialize(server);
      
      server.listen(port, () => {
        console.log(`🚀 Server running on port ${port} (with errors)`);
        console.log(`🌐 Health check: http://localhost:${port}/health`);
        console.log(`🔌 WebSocket endpoint: ws://localhost:${port}/ws`);
        console.log('⚠️ Some features may not work due to startup errors');
      });
    } catch (listenError) {
      console.error('❌ Failed to start server completely:', listenError);
      process.exit(1);
    }
  }
}

startServer(); 
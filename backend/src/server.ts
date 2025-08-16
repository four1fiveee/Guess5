import "reflect-metadata";
const app = require('./app');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { validateSolanaConfig } = require('./config/wallet');
const { validateConfig, config } = require('./config/environment');

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
    
    // Start server after database is ready
    const port = config.server.port;
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🌐 Health check: http://localhost:${port}/health`);
      console.log(`🎮 Ready for multiplayer matchmaking!`);
      console.log(`🎯 Security configuration:`);
      console.log(`   - Environment: ${config.security.nodeEnv}`);
      console.log(`   - ReCaptcha: ${config.security.recaptchaSecret ? 'Enabled' : 'Disabled'}`);
      console.log(`   - Memory limits: ${config.limits.maxActiveGames} active games`);
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
      app.listen(port, () => {
        console.log(`🚀 Server running on port ${port} (with errors)`);
        console.log(`🌐 Health check: http://localhost:${port}/health`);
        console.log('⚠️ Some features may not work due to startup errors');
      });
    } catch (listenError) {
      console.error('❌ Failed to start server completely:', listenError);
      process.exit(1);
    }
  }
}

startServer(); 
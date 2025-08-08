import "reflect-metadata";
const app = require('./app');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { validateSolanaConfig } = require('./config/wallet');
const { validateConfig, config } = require('./config/environment');

// Initialize database before starting server
async function startServer() {
  try {
    // Validate environment variables first
    validateConfig();
    
    // Validate Solana configuration
    validateSolanaConfig();
    
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
    console.error('❌ Database connection failed:', error);
    console.log('⚠️ Starting server without database - matchmaking will be unavailable');
    
    // Start server anyway but matchmaking will fail
    const port = config.server.port;
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port} (without database)`);
      console.log(`🌐 Health check: http://localhost:${port}/health`);
    });
  }
}

startServer(); 
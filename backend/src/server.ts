import "reflect-metadata";
const app = require('./app');
const { initializeDatabase, AppDataSource } = require('./db/index');
const { validateSolanaConfig } = require('./config/wallet');
const { validateEnvironment, config } = require('./config/environment');

// Initialize database before starting server
async function startServer() {
  try {
    // Validate environment variables first
    validateEnvironment();
    
    // Validate Solana configuration
    validateSolanaConfig();
    
    console.log('🔌 Initializing database connection...');
    await initializeDatabase();
    console.log('✅ Database connected successfully');
    
    // Start server after database is ready
    app.listen(config.app.port, () => {
      console.log(`🚀 Server running on port ${config.app.port}`);
      console.log(`🌐 Health check: http://localhost:${config.app.port}/health`);
      console.log(`🎮 Ready for multiplayer matchmaking!`);
      console.log(`🎯 Game configuration:`);
      console.log(`   - Max guesses: ${config.game.maxGuesses}`);
      console.log(`   - Time limit: ${config.game.timeLimit / 1000}s`);
      console.log(`   - Word length: ${config.game.wordLength}`);
      console.log(`   - Matchmaking tolerance: ${config.matchmaking.tolerance} SOL`);
    });
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.log('⚠️ Starting server without database - matchmaking will be unavailable');
    
    // Start server anyway but matchmaking will fail
    app.listen(config.app.port, () => {
      console.log(`🚀 Server running on port ${config.app.port} (without database)`);
      console.log(`🌐 Health check: http://localhost:${config.app.port}/health`);
    });
  }
}

startServer(); 
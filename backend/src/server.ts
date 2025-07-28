import "reflect-metadata";
const app = require('./app');
const { initializeDatabase, AppDataSource } = require('./db/index');

const PORT = process.env.PORT || 4000

// Initialize database before starting server
async function startServer() {
  try {
    console.log('🔌 Initializing database connection...');
    await initializeDatabase();
    console.log('✅ Database connected successfully');
    
    // Start server after database is ready
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.log('⚠️ Starting server without database - matchmaking will be unavailable');
    
    // Start server anyway but matchmaking will fail
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} (without database)`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    });
  }
}

startServer(); 
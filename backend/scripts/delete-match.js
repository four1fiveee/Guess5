// Load .env from project root (two levels up from backend/scripts)
const path = require('path');
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });
const { Pool } = require('pg');

async function deleteMatch(matchId) {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.log('💡 Tip: Make sure you have a .env file with DATABASE_URL set');
    process.exit(1);
  }

  console.log('🔗 Connecting to database...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🗑️ Deleting match:', matchId);
    
    const client = await pool.connect();
    console.log('✅ Database connection established');
    
    try {
      // Check if match exists
      console.log('🔍 Checking if match exists...');
      const checkResult = await client.query('SELECT id FROM "match" WHERE id = $1', [matchId]);
      
      if (checkResult.rows.length === 0) {
        console.log('⚠️ Match not found in database:', matchId);
        console.log('✅ Match may have already been deleted or never existed');
        return;
      }
      
      console.log('✅ Match found, deleting...');
      
      // Delete the match
      const deleteResult = await client.query('DELETE FROM "match" WHERE id = $1', [matchId]);
      
      console.log('✅ Match deleted successfully from database:', matchId);
      console.log('   Rows affected:', deleteResult.rowCount);
      
      // Also try to delete from Redis game state and locks
      if (process.env.REDIS_URL) {
        try {
          console.log('🔗 Connecting to Redis...');
          const redis = require('redis');
          const redisClient = redis.createClient({
            url: process.env.REDIS_URL
          });
          await redisClient.connect();
          console.log('✅ Redis connection established');
          
          // Delete game state
          const gameStateDeleted = await redisClient.del(`game:${matchId}`);
          console.log('✅ Game state deleted from Redis:', gameStateDeleted > 0 ? 'found and deleted' : 'not found');
          
          // Delete matchmaking lock
          const lockDeleted = await redisClient.del(`matchmaking:lock:${matchId}`);
          console.log('✅ Matchmaking lock deleted from Redis:', lockDeleted > 0 ? 'found and deleted' : 'not found');
          
          await redisClient.quit();
        } catch (redisError) {
          console.warn('⚠️ Failed to delete from Redis (non-critical):', redisError?.message);
        }
      } else {
        console.log('⚠️ REDIS_URL not set, skipping Redis cleanup');
      }
      
    } finally {
      client.release();
    }
    
    await pool.end();
    console.log('✅ Match deletion complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to delete match:', error?.message || String(error));
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Database connection refused. Make sure:');
      console.error('   1. DATABASE_URL is set correctly in .env');
      console.error('   2. The database is accessible from your network');
      console.error('   3. For remote databases, ensure SSL is configured correctly');
    }
    console.error(error?.stack);
    await pool.end();
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('❌ Usage: node delete-match.js <matchId>');
  process.exit(1);
}

deleteMatch(matchId);

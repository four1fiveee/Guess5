require('dotenv').config();
const { Client } = require('pg');
const { createClient } = require('redis');

async function clearLockAndDeleteMatch(matchId) {
  let pgClient = null;
  let redisClient = null;

  try {
    console.log(`🔧 Clearing Redis lock and deleting match: ${matchId}`);

    // Step 1: Connect to Redis and clear the proposal lock
    console.log('🔌 Connecting to Redis...');
    redisClient = createClient({
      username: process.env.REDIS_MM_USER || 'default',
      password: process.env.REDIS_MM_PASSWORD || '',
      socket: {
        host: process.env.REDIS_MM_HOST || 'localhost',
        port: parseInt(process.env.REDIS_MM_PORT || '6379'),
        tls: process.env.REDIS_MM_TLS === 'true',
        rejectUnauthorized: false
      }
    });

    await redisClient.connect();
    console.log('✅ Redis connected');

    // Clear the proposal lock
    const lockKey = `proposal:lock:${matchId}`;
    const lockResult = await redisClient.del(lockKey);
    console.log(`✅ Redis lock cleared: ${lockKey} (keys deleted: ${lockResult})`);

    await redisClient.quit();
    console.log('🔌 Redis disconnected');

    // Step 2: Connect to PostgreSQL and delete the match
    console.log('🔌 Connecting to PostgreSQL...');
    pgClient = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await pgClient.connect();
    console.log('✅ PostgreSQL connected');

    // Delete the match
    const result = await pgClient.query(
      'DELETE FROM "match" WHERE id = $1',
      [matchId]
    );

    console.log(`✅ Match deleted: ${matchId} (rows affected: ${result.rowCount})`);

    await pgClient.end();
    console.log('🔌 PostgreSQL disconnected');

    console.log('🎉 Successfully cleared Redis lock and deleted match!');
    
    return {
      success: true,
      lockKeysDeleted: lockResult,
      matchRowsDeleted: result.rowCount
    };

  } catch (error) {
    console.error('❌ Error:', error);
    
    // Cleanup connections
    if (redisClient) {
      try { await redisClient.quit(); } catch (e) { /* ignore */ }
    }
    if (pgClient) {
      try { await pgClient.end(); } catch (e) { /* ignore */ }
    }
    
    throw error;
  }
}

// Run the script
const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node clear-lock-and-delete.js <matchId>');
  process.exit(1);
}

clearLockAndDeleteMatch(matchId)
  .then((result) => {
    console.log('Result:', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

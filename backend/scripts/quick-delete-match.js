/**
 * Quick script to delete a match directly from database
 * Usage: DATABASE_URL=... node quick-delete-match.js <matchId>
 */

const { Pool } = require('pg');

const matchId = process.argv[2];
if (!matchId) {
  console.error('❌ Usage: DATABASE_URL=... node quick-delete-match.js <matchId>');
  process.exit(1);
}

// Get DATABASE_URL from environment or use default
const databaseUrl = process.env.DATABASE_URL || "postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require";

async function deleteMatch() {
  console.log('🔗 Connecting to database...');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    console.log('✅ Database connection established');
    
    try {
      console.log('🗑️ Deleting match:', matchId);
      const deleteResult = await client.query('DELETE FROM "match" WHERE id = $1', [matchId]);
      
      if (deleteResult.rowCount > 0) {
        console.log('✅ Match deleted successfully');
        console.log('   Rows affected:', deleteResult.rowCount);
      } else {
        console.log('⚠️ Match not found or already deleted');
      }
    } finally {
      client.release();
    }
    
    await pool.end();
    console.log('✅ Deletion complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to delete match:', error?.message || String(error));
    console.error(error?.stack);
    await pool.end();
    process.exit(1);
  }
}

deleteMatch();

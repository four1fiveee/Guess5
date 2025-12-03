// Quick delete script - uses DATABASE_URL from environment
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const matchId = process.argv[2];
if (!matchId) {
  console.error('❌ Usage: node quick-delete-match.js <matchId>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

async function deleteMatch() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    const result = await pool.query('DELETE FROM "match" WHERE id = $1', [matchId]);
    console.log(`✅ Deleted ${result.rowCount} match(es): ${matchId}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

deleteMatch();

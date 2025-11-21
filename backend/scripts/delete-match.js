// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

async function deleteMatch(matchId) {
  // Get DATABASE_URL from environment
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.error('Please set DATABASE_URL in your .env file or environment');
    process.exit(1);
  }

  console.log('🔍 Connecting to database...');
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('render.com') ? {
      rejectUnauthorized: false
    } : false
  });

  try {
    await client.connect();
    console.log('✅ Database connected');

    // First, check if match exists
    const checkResult = await client.query(
      'SELECT id, status, "player1", "player2" FROM "match" WHERE id = $1',
      [matchId]
    );

    if (checkResult.rows.length === 0) {
      console.log('⚠️ Match not found:', matchId);
      await client.end();
      process.exit(0);
    }

    console.log('📋 Match found:', checkResult.rows[0]);

    // Delete the match
    const result = await client.query(
      'DELETE FROM "match" WHERE id = $1',
      [matchId]
    );

    console.log('✅ Match deleted:', matchId);
    console.log('Rows affected:', result.rowCount);

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error deleting match:', error.message);
    console.error('Full error:', error);
    await client.end();
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node delete-match.js <matchId>');
  process.exit(1);
}

deleteMatch(matchId);

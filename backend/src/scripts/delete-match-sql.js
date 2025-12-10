const { Client } = require('pg');
require('dotenv').config();

async function deleteMatch() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  try {
    await client.connect();
    console.log('✅ Database connected');
    
    const matchId = process.argv[2] || 'd144e0f4-377a-46d2-8068-73db4be8410b';
    
    // Check if match exists
    const checkResult = await client.query('SELECT id, "player1", "player2", "proposalStatus", "proposalTransactionId" FROM "match" WHERE id = $1', [matchId]);
    
    if (checkResult.rows.length === 0) {
      console.log('❌ Match not found:', matchId);
      await client.end();
      process.exit(1);
    }
    
    console.log('📊 Match to delete:', checkResult.rows[0]);
    
    // Delete the match
    await client.query('DELETE FROM "match" WHERE id = $1', [matchId]);
    console.log('✅ Match deleted successfully');
    
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    await client.end();
    process.exit(1);
  }
}

deleteMatch();

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

async function deleteStuckMatches() {
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
    const client = await pool.connect();
    console.log('✅ Database connection established');
    
    try {
      // Find all stuck matches
      console.log('🔍 Finding stuck matches...');
      const stuckMatches = await client.query(`
        SELECT 
          id,
          "player1",
          "player2",
          winner,
          "matchStatus",
          "proposalStatus",
          "payoutProposalId",
          "tieRefundProposalId",
          "isCompleted",
          "updatedAt"
        FROM "match"
        WHERE "proposalStatus" = 'PENDING'
          AND "payoutProposalId" IS NULL
          AND "tieRefundProposalId" IS NULL
          AND "isCompleted" = true
          AND "updatedAt" < NOW() - INTERVAL '2 minutes'
        ORDER BY "updatedAt" DESC
      `);
      
      console.log(`📊 Found ${stuckMatches.rows.length} stuck matches`);
      
      if (stuckMatches.rows.length === 0) {
        console.log('✅ No stuck matches found');
        return;
      }
      
      // Show matches to be deleted
      console.log('\n📋 Matches to be deleted:');
      stuckMatches.rows.forEach((match, index) => {
        const matchId = match.id instanceof Buffer 
          ? match.id.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
          : match.id;
        console.log(`  ${index + 1}. ${matchId} - Winner: ${match.winner || 'tie'} - Updated: ${match.updatedAt}`);
      });
      
      // Delete all stuck matches
      console.log('\n🗑️ Deleting stuck matches...');
      const deleteResult = await client.query(`
        DELETE FROM "match"
        WHERE "proposalStatus" = 'PENDING'
          AND "payoutProposalId" IS NULL
          AND "tieRefundProposalId" IS NULL
          AND "isCompleted" = true
          AND "updatedAt" < NOW() - INTERVAL '2 minutes'
      `);
      
      console.log(`✅ Deleted ${deleteResult.rowCount} stuck matches`);
      
    } finally {
      client.release();
    }
    
    await pool.end();
    console.log('✅ Cleanup complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to delete stuck matches:', error?.message || String(error));
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

deleteStuckMatches();


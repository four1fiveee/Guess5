require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

async function readMatch(matchId) {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT 
        id, "player1", "player2", winner, 
        "player1Result", "player2Result",
        "matchStatus", "proposalStatus", "payoutProposalId"
      FROM "match" 
      WHERE id = $1
    `, [matchId]);
    
    if (result.rows.length === 0) {
      console.log('❌ Match not found');
      return;
    }
    
    const match = result.rows[0];
    console.log('\n📊 MATCH DATA:');
    console.log('ID:', match.id);
    console.log('Player 1:', match.player1);
    console.log('Player 2:', match.player2);
    console.log('Winner:', match.winner);
    console.log('Match Status:', match.matchStatus);
    console.log('Proposal Status:', match.proposalStatus);
    console.log('Payout Proposal ID:', match.payoutProposalId);
    
    console.log('\n📊 PLAYER 1 RESULT:');
    if (match.player1Result) {
      const p1Result = typeof match.player1Result === 'string' ? JSON.parse(match.player1Result) : match.player1Result;
      console.log(JSON.stringify(p1Result, null, 2));
    } else {
      console.log('null');
    }
    
    console.log('\n📊 PLAYER 2 RESULT:');
    if (match.player2Result) {
      const p2Result = typeof match.player2Result === 'string' ? JSON.parse(match.player2Result) : match.player2Result;
      console.log(JSON.stringify(p2Result, null, 2));
    } else {
      console.log('null');
    }
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error?.message || String(error));
    await pool.end();
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('❌ Usage: node read-match.js <matchId>');
  process.exit(1);
}

readMatch(matchId);


/**
 * Investigate match proposal status
 * Usage: node scripts/investigate-match-proposal.js <matchId>
 */

// Direct database connection to avoid loading services that require env vars
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function investigateMatch(matchId) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    console.log('✅ Connecting to database...');
    
    // Query match with all proposal-related fields
    const result = await pool.query(`
      SELECT 
        id, "player1", "player2", "entryFee", status, word,
        "squadsVaultAddress", "squadsVaultPda", 
        "payoutProposalId", "tieRefundProposalId", 
        "proposalStatus", "proposalSigners", "needsSignatures",
        "proposalExecutedAt", "proposalTransactionId",
        winner, "isCompleted", "createdAt", "updatedAt"
      FROM "match"
      WHERE id = $1
      LIMIT 1
    `, [matchId]);
    
    if (!result.rows || result.rows.length === 0) {
      console.log('❌ Match not found:', matchId);
      await pool.end();
      process.exit(1);
    }
    
    const match = result.rows[0];
    
    console.log('\n📋 Match Data:');
    console.log('='.repeat(80));
    console.log('Match ID:', match.id);
    console.log('Player 1:', match.player1);
    console.log('Player 2:', match.player2);
    console.log('Status:', match.status);
    console.log('Winner:', match.winner || 'N/A');
    console.log('Squads Vault Address:', match.squadsVaultAddress || 'N/A');
    console.log('Squads Vault PDA:', match.squadsVaultPda || 'N/A');
    console.log('\n📝 Proposal Data:');
    console.log('='.repeat(80));
    console.log('Payout Proposal ID:', match.payoutProposalId || 'N/A');
    console.log('Tie Refund Proposal ID:', match.tieRefundProposalId || 'N/A');
    console.log('Proposal Status:', match.proposalStatus || 'N/A');
    console.log('Needs Signatures:', match.needsSignatures || 'N/A');
    
    // Parse proposal signers
    let proposalSigners = [];
    if (match.proposalSigners) {
      try {
        proposalSigners = typeof match.proposalSigners === 'string' 
          ? JSON.parse(match.proposalSigners) 
          : match.proposalSigners;
      } catch (e) {
        console.warn('⚠️ Failed to parse proposalSigners:', e.message);
      }
    }
    console.log('Proposal Signers:', proposalSigners.length > 0 ? proposalSigners : 'None');
    console.log('Proposal Executed At:', match.proposalExecutedAt || 'N/A');
    console.log('Proposal Transaction ID:', match.proposalTransactionId || 'N/A');
    
    // Determine which proposal ID to check
    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    
    if (!proposalId) {
      console.log('\n⚠️ No proposal ID found for this match');
      console.log('This match may not have a proposal created yet.');
    } else {
      console.log('\n🎯 Active Proposal ID:', proposalId);
      console.log('Use this proposal ID with Squads MCP to check on-chain status');
    }
    
    // Output JSON for easy parsing
    console.log('\n📊 JSON Output:');
    console.log('='.repeat(80));
    console.log(JSON.stringify({
      matchId: match.id,
      player1: match.player1,
      player2: match.player2,
      status: match.status,
      winner: match.winner,
      squadsVaultAddress: match.squadsVaultAddress,
      squadsVaultPda: match.squadsVaultPda,
      payoutProposalId: match.payoutProposalId,
      tieRefundProposalId: match.tieRefundProposalId,
      proposalStatus: match.proposalStatus,
      needsSignatures: match.needsSignatures,
      proposalSigners: proposalSigners,
      proposalExecutedAt: match.proposalExecutedAt,
      proposalTransactionId: match.proposalTransactionId,
    }, null, 2));
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node scripts/investigate-match-proposal.js <matchId>');
  process.exit(1);
}

investigateMatch(matchId);


/**
 * Script to check match details from database
 * Usage: npx ts-node scripts/check-match.ts <matchId>
 */

// @ts-nocheck
const { AppDataSource } = require('../src/db/index');
const { Match } = require('../src/models/Match');

async function checkMatch(matchId: string) {
  try {
    console.log('🔧 Initializing database connection...');
    await AppDataSource.initialize();

    console.log(`🔍 Looking up match ${matchId} in database...`);
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      console.error(`❌ Match ${matchId} not found.`);
      return;
    }

    console.log('✅ Match found:');
    console.log(JSON.stringify({
      id: match.id,
      player1: match.player1,
      player2: match.player2,
      entryFee: match.entryFee,
      winner: match.winner,
      status: match.status,
      squadsVaultAddress: match.squadsVaultAddress,
      squadsVaultPda: (match as any).squadsVaultPda,
      payoutProposalId: (match as any).payoutProposalId,
      tieRefundProposalId: (match as any).tieRefundProposalId,
      proposalStatus: (match as any).proposalStatus,
      proposalExecutedAt: (match as any).proposalExecutedAt,
      proposalTransactionId: (match as any).proposalTransactionId,
      needsSignatures: (match as any).needsSignatures,
      proposalSigners: (match as any).proposalSigners,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
    }, null, 2));

  } catch (error: unknown) {
    console.error('❌ An unexpected error occurred:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log('🔌 Database connection closed.');
    }
  }
}

const matchIdArg = process.argv[2];
if (!matchIdArg) {
  console.error('Usage: npx ts-node scripts/check-match.ts <matchId>');
  process.exit(1);
}

checkMatch(matchIdArg);






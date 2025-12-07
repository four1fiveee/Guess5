const { AppDataSource } = require('../db');
const { Match } = require('../models/Match');

async function fixMatchState(matchId) {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connected');
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    console.log('\n📊 Current Database State:');
    console.log('  Match ID:', match.id);
    console.log('  Proposal Status:', match.proposalStatus);
    console.log('  Needs Signatures:', match.needsSignatures);
    console.log('  Proposal Signers:', match.proposalSigners);
    console.log('  Proposal Executed At:', match.proposalExecutedAt);
    
    // Parse proposal signers
    let signers = [];
    try {
      if (typeof match.proposalSigners === 'string') {
        signers = JSON.parse(match.proposalSigners);
      } else if (Array.isArray(match.proposalSigners)) {
        signers = match.proposalSigners;
      }
    } catch (e) {
      console.error('❌ Failed to parse proposalSigners:', e.message);
    }
    
    const signerCount = signers.length;
    const currentNeedsSignatures = match.needsSignatures || 0;
    const threshold = 2; // Standard threshold for 2-player matches
    
    console.log('\n🔍 Analysis:');
    console.log('  Signer Count:', signerCount);
    console.log('  Current needsSignatures:', currentNeedsSignatures);
    console.log('  Threshold:', threshold);
    console.log('  Calculated needsSignatures:', Math.max(0, threshold - signerCount));
    
    if (signerCount >= threshold && currentNeedsSignatures > 0) {
      console.log('\n🔧 Fixing database state...');
      
      const correctNeedsSignatures = Math.max(0, threshold - signerCount);
      const correctStatus = match.proposalExecutedAt ? 'EXECUTED' : 'READY_TO_EXECUTE';
      
      await matchRepository.query(`
        UPDATE "match"
        SET "needsSignatures" = $1,
            "proposalStatus" = $2,
            "updatedAt" = NOW()
        WHERE id = $3
          AND "proposalExecutedAt" IS NULL
      `, [correctNeedsSignatures, correctStatus, matchId]);
      
      console.log('✅ Database state fixed:', {
        needsSignatures: correctNeedsSignatures,
        proposalStatus: correctStatus,
      });
      
      // Verify the update
      const updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
      console.log('\n✅ Verified Update:');
      console.log('  Needs Signatures:', updatedMatch.needsSignatures);
      console.log('  Proposal Status:', updatedMatch.proposalStatus);
      
    } else if (signerCount < threshold) {
      console.log('\n⚠️ Not enough signers yet:', {
        signerCount,
        threshold,
        needsSignatures: threshold - signerCount,
      });
    } else {
      console.log('\n✅ Database state is correct');
    }
    
    await AppDataSource.destroy();
    console.log('\n✅ Fix complete');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node fix-match-state.js <matchId>');
  process.exit(1);
}

fixMatchState(matchId);


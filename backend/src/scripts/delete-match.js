const { AppDataSource } = require('../db');
const { Match } = require('../models/Match');

async function deleteMatch() {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connected');
    
    const matchRepository = AppDataSource.getRepository(Match);
    const matchId = process.argv[2];
    
    if (!matchId) {
      console.error('Usage: node delete-match.js <matchId>');
      process.exit(1);
    }
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      console.log('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    console.log('📊 Match to delete:', {
      id: match.id,
      player1: match.player1,
      player2: match.player2,
      proposalStatus: match.proposalStatus,
      proposalTransactionId: match.proposalTransactionId,
    });
    
    await matchRepository.remove(match);
    console.log('✅ Match deleted successfully');
    
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

deleteMatch();

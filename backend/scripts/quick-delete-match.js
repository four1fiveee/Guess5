require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { AppDataSource } = require('../src/db/index');
const { Match } = require('../src/models/Match');

async function deleteMatch(matchId) {
  try {
    console.log('🔗 Initializing database connection...');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    console.log('✅ Database connected');

    const matchRepository = AppDataSource.getRepository(Match);
    
    console.log('🔍 Checking if match exists...', matchId);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.log('⚠️ Match not found:', matchId);
      return;
    }
    
    console.log('✅ Match found, deleting...');
    await matchRepository.remove(match);
    
    console.log('✅ Match deleted successfully:', matchId);
    
    await AppDataSource.destroy();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to delete match:', error?.message || String(error));
    console.error(error?.stack);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('❌ Usage: node quick-delete-match.js <matchId>');
  process.exit(1);
}

deleteMatch(matchId);


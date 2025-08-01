// Set the database URL
process.env.DATABASE_URL = 'postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require';

const { AppDataSource } = require('./dist/db/index');
const { Match } = require('./dist/models/Match');

async function clearDatabase() {
  try {
    console.log('🔌 Connecting to database...');
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    const matchRepository = AppDataSource.getRepository(Match);
    
    console.log('🧹 Clearing all matches from database...');
    
    // Get all matches
    const allMatches = await matchRepository.find();
    console.log(`📊 Found ${allMatches.length} total matches`);
    
    if (allMatches.length > 0) {
      // Remove all matches
      await matchRepository.remove(allMatches);
      console.log(`✅ Cleared ${allMatches.length} matches from database`);
    } else {
      console.log('✅ Database is already empty');
    }
    
    console.log('🎉 Database cleanup completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
}

clearDatabase(); 
/**
 * Simple script to delete a match from the database
 * Usage: node scripts/deleteMatch.js <matchId>
 */

require('dotenv').config();
const { DataSource } = require('typeorm');
const path = require('path');

const matchId = process.argv[2] || 'aebc06bb-30ef-465f-8fc1-eae608ecae39';

// Database configuration from environment
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [path.join(__dirname, '../dist/models/**/*.js')],
  synchronize: false,
  logging: false,
});

async function deleteMatch() {
  try {
    console.log('🔌 Connecting to database...');
    await AppDataSource.initialize();
    console.log('✅ Database connected');
    
    // Get the Match entity from dist
    const Match = require('../dist/models/Match').Match;
    const matchRepository = AppDataSource.getRepository(Match);
    
    console.log('🔍 Looking for match:', matchId);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    console.log('📋 Match found:', {
      id: match.id,
      winner: match.winner,
      player1: match.player1,
      player2: match.player2,
    });
    
    console.log('🗑️ Deleting match...');
    await matchRepository.remove(match);
    
    console.log('✅ Match deleted successfully!');
    console.log('🎉 You can now create a new test game.');
    
    await AppDataSource.destroy();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

deleteMatch();




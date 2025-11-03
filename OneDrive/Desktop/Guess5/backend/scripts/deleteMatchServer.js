/**
 * Standalone Express server to delete a match
 * Usage: node scripts/deleteMatchServer.js
 * Then call: DELETE http://localhost:3001/api/match/delete/:matchId
 */

require('dotenv').config();
const express = require('express');
const { DataSource } = require('typeorm');
const path = require('path');

const app = express();
app.use(express.json());

// Database configuration
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

// Delete match endpoint
app.delete('/api/match/delete/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    console.log('🗑️ Deleting match:', matchId);
    
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    
    const Match = require('../dist/models/Match').Match;
    const matchRepository = AppDataSource.getRepository(Match);
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    await matchRepository.remove(match);
    
    console.log('✅ Match deleted:', matchId);
    res.json({ success: true, message: 'Match deleted', matchId });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🗑️ Delete match server running on port ${PORT}`);
  console.log(`   DELETE http://localhost:${PORT}/api/match/delete/<matchId>`);
});


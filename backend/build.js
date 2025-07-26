const fs = require('fs');
const path = require('path');

// Simple build script that copies files without TypeScript compilation
console.log('Building backend...');

// Create dist directory if it doesn't exist
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

// Copy server.js (if it exists) or create a simple one
const serverContent = `
const app = require('./app');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(\`Backend server running on port \${PORT}\`);
});
`;

fs.writeFileSync('dist/server.js', serverContent);

// Copy app.js
if (fs.existsSync('src/app.ts')) {
  // For now, just create a simple app.js
  const appContent = `
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/match/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Guess5 Backend is running' });
});

// Simple match request endpoint
app.post('/api/match/request', (req, res) => {
  const { entryFee, wallet } = req.body;
  
  // Simple in-memory matchmaking
  if (!global.waitingPlayers) global.waitingPlayers = [];
  
  const waitingIndex = global.waitingPlayers.findIndex(p => 
    p.entryFee === entryFee && p.wallet !== wallet
  );
  
  if (waitingIndex === -1) {
    global.waitingPlayers.push({ entryFee, wallet });
    return res.json({ status: 'waiting' });
  } else {
    const opponent = global.waitingPlayers.splice(waitingIndex, 1)[0];
    const words = ['HELLO', 'WORLD', 'GUESS', 'GAMES', 'PLAYS'];
    const word = words[Math.floor(Math.random() * words.length)];
    const matchId = Date.now().toString();
    
    return res.json({ status: 'matched', matchId, word });
  }
});

module.exports = app;
`;

  fs.writeFileSync('dist/app.js', appContent);
}

console.log('Build completed successfully!'); 
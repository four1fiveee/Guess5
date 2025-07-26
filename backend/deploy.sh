#!/bin/bash

echo "🚀 Deploying Guess5 Backend..."

# Ensure dist directory exists
mkdir -p dist

# Check if server.js exists, if not create it
if [ ! -f "dist/server.js" ]; then
    echo "Creating server.js..."
    cat > dist/server.js << 'EOF'
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
    const words = ['HELLO', 'WORLD', 'GUESS', 'GAMES', 'PLAYS', 'SOLVE', 'BRAIN', 'LOGIC', 'SMART', 'QUICK'];
    const word = words[Math.floor(Math.random() * words.length)];
    const matchId = Date.now().toString();
    
    return res.json({ status: 'matched', matchId, word });
  }
});

// Match confirmation endpoint
app.post('/api/match/confirm', (req, res) => {
  res.json({ success: true });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
EOF
fi

echo "✅ Deployment ready!"
echo "Starting server..."
node dist/server.js 
// Simple script to clear Redis matchmaking data for testing
const fetch = require('node-fetch');

async function clearRedisMatchmaking() {
  try {
    const apiUrl = process.env.API_URL || 'https://guess5.onrender.com';
    const response = await fetch(`${apiUrl}/api/match/clear-matchmaking-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    console.log('✅ Redis matchmaking data cleared:', result);
  } catch (error) {
    console.error('❌ Error clearing Redis matchmaking data:', error);
  }
}

// Run the cleanup
clearRedisMatchmaking();

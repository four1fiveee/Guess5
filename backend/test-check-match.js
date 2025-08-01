// Test script to check what the check-match endpoint returns
const fetch = require('node-fetch');

async function testCheckMatch() {
  const players = [
    '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU',
    'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8'
  ];

  for (const player of players) {
    try {
      console.log(`\n🔍 Testing check-match for player: ${player}`);
      const response = await fetch(`https://guess5.onrender.com/api/match/check-match/${player}`);
      const data = await response.json();
      console.log('Response:', JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`❌ Error checking match for ${player}:`, error.message);
    }
  }
}

testCheckMatch(); 
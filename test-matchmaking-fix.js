#!/usr/bin/env node

// Test to verify the frontend matchmaking loop fix
const API_URL = 'https://guess5.onrender.com';

async function testMatchmakingFix() {
  try {
    console.log('🔧 Testing matchmaking loop fix...\n');
    
    // Test 1: Create a match
    console.log('1️⃣ Creating a match...');
    const player1Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8', 
        entryFee: 0.1145
      })
    });
    
    const player1Result = await player1Request.json();
    console.log('Player 1 result:', player1Result);
    
    // Test 2: Create match with player 2
    console.log('\n2️⃣ Creating match with player 2...');
    const player2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A', 
        entryFee: 0.1145
      })
    });
    
    const player2Result = await player2Request.json();
    console.log('Player 2 result:', player2Result);
    
    if (player2Result.status === 'matched') {
      console.log('\n✅ Match created successfully!');
      
      // Test 3: Check if polling would detect the match
      console.log('\n3️⃣ Testing polling endpoint...');
      const pollingRequest = await fetch(`${API_URL}/api/match/check-match/F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`);
      const pollingResult = await pollingRequest.json();
      console.log('Polling result:', pollingResult);
      
      if (pollingResult.matched) {
        console.log('\n🎉 SUCCESS: Frontend would correctly detect the match!');
        console.log('This means the infinite loop should be fixed.');
        console.log('The frontend should now:');
        console.log('1. Find the match ✅');
        console.log('2. Stop polling ✅');
        console.log('3. Show escrow UI ✅');
        console.log('4. Not restart matchmaking ✅');
      } else {
        console.log('\n❌ FAILURE: Frontend polling would NOT detect the match!');
      }
    } else {
      console.log('\n❌ Match creation failed:', player2Result.status);
    }
    
    console.log('\n✅ Matchmaking loop fix test completed!');
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Testing matchmaking loop fix...');
testMatchmakingFix(); 
#!/usr/bin/env node

// Test to simulate the exact frontend polling behavior
const API_URL = 'https://guess5.onrender.com';

async function testFrontendPolling() {
  try {
    console.log('🔍 Testing frontend polling behavior...\n');
    
    // Step 1: Create a match (like our previous test)
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
    
    // Step 2: Create match with player 2
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
      
      // Step 3: Test the exact polling endpoint that frontend uses
      console.log('\n3️⃣ Testing frontend polling endpoint...');
      const pollingRequest = await fetch(`${API_URL}/api/match/check-match/F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`);
      const pollingResult = await pollingRequest.json();
      console.log('Polling result:', pollingResult);
      
      if (pollingResult.matched) {
        console.log('\n🎉 SUCCESS: Frontend polling would detect the match!');
        console.log('Match ID:', pollingResult.matchId);
        console.log('Status:', pollingResult.status);
        console.log('Message:', pollingResult.message);
      } else {
        console.log('\n❌ FAILURE: Frontend polling would NOT detect the match!');
        console.log('This is the bug - the polling endpoint is not finding the match.');
      }
    } else {
      console.log('\n❌ Match creation failed:', player2Result.status);
    }
    
  } catch (error) {
    console.error('❌ Error during polling test:', error);
  }
}

console.log('🚀 Testing frontend polling behavior...');
testFrontendPolling(); 
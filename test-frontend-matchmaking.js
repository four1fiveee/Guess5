#!/usr/bin/env node

// Test to simulate the exact frontend matchmaking behavior
const API_URL = 'https://guess5.onrender.com';

async function testFrontendMatchmaking() {
  try {
    console.log('🔍 Testing frontend matchmaking behavior...\n');
    
    // Step 1: Clean up stuck matches (like frontend does)
    console.log('1️⃣ Cleaning up stuck matches...');
    const cleanupRequest = await fetch(`${API_URL}/api/match/cleanup-stuck-matches`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8'
      })
    });
    
    const cleanupResult = await cleanupRequest.json();
    console.log('Cleanup result:', cleanupResult);
    
    // Step 2: Request match with exact frontend parameters
    console.log('\n2️⃣ Requesting match with frontend parameters...');
    const matchRequest = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8', 
        entryFee: 0.1145  // Exact fee from frontend logs
      })
    });
    
    const matchResult = await matchRequest.json();
    console.log('Match result:', matchResult);
    
    // Step 3: Check what waiting players exist
    console.log('\n3️⃣ Checking for waiting players...');
    const checkRequest = await fetch(`${API_URL}/api/match/check-match/F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`);
    const checkResult = await checkRequest.json();
    console.log('Check result:', checkResult);
    
    // Step 4: Try to find a match with a different wallet
    console.log('\n4️⃣ Testing with different wallet...');
    const player2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A', 
        entryFee: 0.1145  // Same fee
      })
    });
    
    const player2Result = await player2Request.json();
    console.log('Player 2 result:', player2Result);
    
    // Step 5: Check if they should have matched
    if (player2Result.status === 'matched') {
      console.log('\n🎉 SUCCESS: Players should have matched!');
      console.log('Match ID:', player2Result.matchId);
    } else {
      console.log('\n❌ Players did not match. Status:', player2Result.status);
      console.log('This suggests the matchmaking logic has an issue with fee matching.');
    }
    
  } catch (error) {
    console.error('❌ Error during frontend test:', error);
  }
}

console.log('🚀 Testing frontend matchmaking behavior...');
testFrontendMatchmaking(); 
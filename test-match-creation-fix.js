#!/usr/bin/env node

// Test to verify the match creation fix prevents newly created matches from being cleaned up
const API_URL = 'https://guess5.onrender.com';

async function testMatchCreationFix() {
  try {
    console.log('🔧 Testing match creation fix...\n');
    
    // Test 1: Create player 1
    console.log('1️⃣ Creating player 1...');
    const player1Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU', 
        entryFee: 0.12
      })
    });
    
    const player1Result = await player1Request.json();
    console.log('Player 1 result:', player1Result);
    
    // Test 2: Create player 2
    console.log('\n2️⃣ Creating player 2...');
    const player2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8', 
        entryFee: 0.12
      })
    });
    
    const player2Result = await player2Request.json();
    console.log('Player 2 result:', player2Result);
    
    if (player2Result.status === 'matched') {
      console.log('\n🎉 SUCCESS: Players matched!');
      console.log('Match ID:', player2Result.matchId);
      console.log('Entry Fee:', player2Result.entryFee);
      
      // Test 3: Check if polling finds the match
      console.log('\n3️⃣ Testing polling endpoint...');
      const pollingRequest = await fetch(`${API_URL}/api/match/check-match/F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`);
      const pollingResult = await pollingRequest.json();
      console.log('Polling result:', pollingResult);
      
      if (pollingResult.matched) {
        console.log('\n✅ SUCCESS: Polling correctly found the match!');
        console.log('This means the match was NOT cleaned up immediately');
        console.log('Frontend should now show "Lock Entry Fee" button');
      } else {
        console.log('\n❌ FAILURE: Polling did NOT find the match');
        console.log('The match was still cleaned up immediately');
      }
    } else {
      console.log('\n❌ FAILURE: Players did not match');
      console.log('Status:', player2Result.status);
      console.log('Message:', player2Result.message);
    }
    
    console.log('\n📋 SUMMARY:');
    console.log('- Fixed: cleanupOldMatches now excludes escrow status matches');
    console.log('- Expected: Newly created matches should NOT be cleaned up');
    console.log('- Expected: Polling should find the match');
    console.log('- Expected: Frontend should show "Lock Entry Fee" button');
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Testing match creation fix...');
testMatchCreationFix(); 
#!/usr/bin/env node

// Test to verify the deduplication fix allows proper matchmaking
const API_URL = 'https://guess5.onrender.com';

async function testDeduplicationFix() {
  try {
    console.log('🔧 Testing deduplication fix...\n');
    
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
      console.log('\n🎉 SUCCESS: Players matched! Deduplication fix worked!');
      console.log('Match ID:', player2Result.matchId);
      console.log('Entry Fee:', player2Result.entryFee);
    } else if (player2Result.duplicate) {
      console.log('\n❌ FAILURE: Still getting duplicate request error');
      console.log('The deduplication is still too aggressive');
    } else {
      console.log('\n⚠️ Players not matching, but no duplicate error');
      console.log('Status:', player2Result.status);
      console.log('Message:', player2Result.message);
    }
    
    // Test 3: Check if polling works
    console.log('\n3️⃣ Testing polling endpoint...');
    const pollingRequest = await fetch(`${API_URL}/api/match/check-match/F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`);
    const pollingResult = await pollingRequest.json();
    console.log('Polling result:', pollingResult);
    
    console.log('\n📋 SUMMARY:');
    console.log('- Deduplication window: Increased from 1s to 5s');
    console.log('- Allow requests after 2s even within window');
    console.log('- Only applies to specific endpoints');
    console.log('- Should allow proper matchmaking now');
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Testing deduplication fix...');
testDeduplicationFix(); 
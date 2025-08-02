#!/usr/bin/env node

// Test to diagnose the specific matchmaking issue with these two wallets
const API_URL = 'https://guess5.onrender.com';

async function testSpecificMatchmakingIssue() {
  try {
    console.log('🔍 Diagnosing specific matchmaking issue...\n');
    
    const wallet1 = '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU';
    const wallet2 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
    
    // Test 1: Check what entry fee wallet2 is using
    console.log('1️⃣ Testing wallet2 with different entry fees...');
    
    const entryFees = [0.1235, 0.1230, 0.1240, 0.12, 0.13];
    
    for (const fee of entryFees) {
      console.log(`\nTesting entry fee: ${fee} SOL`);
      
      const request = await fetch(`${API_URL}/api/match/request-match`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Origin': 'https://guess5.vercel.app'
        },
        body: JSON.stringify({ 
          wallet: wallet2, 
          entryFee: fee
        })
      });
      
      const result = await request.json();
      console.log(`Result: ${result.status} - ${result.message}`);
      
      if (result.status === 'matched') {
        console.log('🎉 SUCCESS: Found matching entry fee!');
        console.log('Matching entry fee:', fee, 'SOL');
        break;
      }
    }
    
    // Test 2: Check if there are any waiting players
    console.log('\n2️⃣ Checking for waiting players...');
    try {
      const waitingRequest = await fetch(`${API_URL}/api/match/debug/waiting`);
      if (waitingRequest.ok) {
        const waitingResult = await waitingRequest.json();
        console.log('Waiting players:', waitingResult);
      } else {
        console.log('Debug endpoint not available');
      }
    } catch (error) {
      console.log('Debug endpoint not available');
    }
    
    // Test 3: Force cleanup and try again
    console.log('\n3️⃣ Force cleanup and retry...');
    const cleanupRequest = await fetch(`${API_URL}/api/match/force-cleanup-wallet`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ wallet: wallet1 })
    });
    
    const cleanupResult = await cleanupRequest.json();
    console.log('Cleanup result:', cleanupResult);
    
    // Test 4: Try matchmaking again with exact same fee
    console.log('\n4️⃣ Retry with exact same entry fee...');
    const retryRequest = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: wallet1, 
        entryFee: 0.1235
      })
    });
    
    const retryResult = await retryRequest.json();
    console.log('Retry result:', retryResult);
    
    // Test 5: Try wallet2 with exact same fee
    console.log('\n5️⃣ Try wallet2 with exact same fee...');
    const wallet2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: wallet2, 
        entryFee: 0.1235
      })
    });
    
    const wallet2Result = await wallet2Request.json();
    console.log('Wallet2 result:', wallet2Result);
    
    if (wallet2Result.status === 'matched') {
      console.log('\n🎉 SUCCESS: Players matched after cleanup!');
    } else {
      console.log('\n❌ FAILURE: Still not matching');
      console.log('This suggests a deeper issue with the matchmaking logic');
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Diagnosing specific matchmaking issue...');
testSpecificMatchmakingIssue(); 
#!/usr/bin/env node

// Test to verify deduplication timing and get past duplicate request issue
const API_URL = 'https://guess5.onrender.com';

async function testDeduplicationTiming() {
  try {
    console.log('🔍 Testing deduplication timing...\n');
    
    const wallet = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
    
    // Test 1: Force cleanup
    console.log('1️⃣ Force cleanup wallet...');
    const cleanup = await fetch(`${API_URL}/api/match/force-cleanup-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet })
    });
    const cleanupResult = await cleanup.json();
    console.log('Cleanup result:', cleanupResult);
    
    // Test 2: Make first request
    console.log('\n2️⃣ Making first request...');
    const request1 = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet, 
        entryFee: 0.1263
      })
    });
    
    const result1 = await request1.json();
    console.log('First request result:', result1);
    
    // Test 3: Wait 1.5 seconds and make second request
    console.log('\n3️⃣ Waiting 1.5 seconds and making second request...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const request2 = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet, 
        entryFee: 0.1263
      })
    });
    
    const result2 = await request2.json();
    console.log('Second request result:', result2);
    
    // Test 4: Wait 3 seconds and make third request
    console.log('\n4️⃣ Waiting 3 seconds and making third request...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const request3 = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet, 
        entryFee: 0.1263
      })
    });
    
    const result3 = await request3.json();
    console.log('Third request result:', result3);
    
    // Test 5: Check if we can find a match
    console.log('\n5️⃣ Testing with different wallet to create match...');
    const otherWallet = '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU';
    
    const otherRequest = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: otherWallet, 
        entryFee: 0.1263
      })
    });
    
    const otherResult = await otherRequest.json();
    console.log('Other wallet result:', otherResult);
    
    console.log('\n📋 SUMMARY:');
    console.log('- First request (immediate):', result1.duplicate ? '❌ Blocked' : '✅ Allowed');
    console.log('- Second request (1.5s later):', result2.duplicate ? '❌ Blocked' : '✅ Allowed');
    console.log('- Third request (3s later):', result3.duplicate ? '❌ Blocked' : '✅ Allowed');
    console.log('- Other wallet request:', otherResult.status);
    
    if (otherResult.status === 'matched') {
      console.log('\n🎉 SUCCESS: Match created with other wallet!');
      console.log('This means the backend is working, just deduplication is blocking the same wallet');
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Testing deduplication timing...');
testDeduplicationTiming(); 
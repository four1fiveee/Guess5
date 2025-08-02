#!/usr/bin/env node

// Test to verify entry fee matching with tolerance
const API_URL = 'https://guess5.onrender.com';

async function testEntryFeeMatching() {
  try {
    console.log('🔍 Testing entry fee matching with tolerance...\n');
    
    // Test 1: Create player 1 with 0.1245 SOL
    console.log('1️⃣ Creating player 1 with 0.1245 SOL...');
    const player1Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU', 
        entryFee: 0.1245
      })
    });
    
    const player1Result = await player1Request.json();
    console.log('Player 1 result:', player1Result);
    
    // Test 2: Create player 2 with 0.1228 SOL
    console.log('\n2️⃣ Creating player 2 with 0.1228 SOL...');
    const player2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8', 
        entryFee: 0.1228
      })
    });
    
    const player2Result = await player2Request.json();
    console.log('Player 2 result:', player2Result);
    
    // Test 3: Check if they should match
    console.log('\n3️⃣ Analyzing entry fee difference...');
    const fee1 = 0.1245;
    const fee2 = 0.1228;
    const difference = Math.abs(fee1 - fee2);
    const tolerance = 0.001;
    const percentageDiff = (difference / fee1) * 100;
    
    console.log(`Entry Fee 1: ${fee1} SOL`);
    console.log(`Entry Fee 2: ${fee2} SOL`);
    console.log(`Difference: ${difference} SOL`);
    console.log(`Tolerance: ${tolerance} SOL`);
    console.log(`Percentage difference: ${percentageDiff.toFixed(2)}%`);
    
    if (difference <= tolerance) {
      console.log('✅ Difference is within tolerance - should match!');
    } else {
      console.log('❌ Difference exceeds tolerance - won\'t match');
      console.log('💡 Try using the same entry fee (e.g., 0.12 SOL)');
    }
    
    // Test 4: Try with same entry fee
    console.log('\n4️⃣ Testing with same entry fee (0.12 SOL)...');
    const sameFeeRequest1 = await fetch(`${API_URL}/api/match/request-match`, {
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
    
    const sameFeeResult1 = await sameFeeRequest1.json();
    console.log('Same fee player 1 result:', sameFeeResult1);
    
    const sameFeeRequest2 = await fetch(`${API_URL}/api/match/request-match`, {
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
    
    const sameFeeResult2 = await sameFeeRequest2.json();
    console.log('Same fee player 2 result:', sameFeeResult2);
    
    if (sameFeeResult2.status === 'matched') {
      console.log('\n🎉 SUCCESS: Players matched with same entry fee!');
    } else {
      console.log('\n❌ Still not matching with same entry fee');
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Testing entry fee matching...');
testEntryFeeMatching(); 
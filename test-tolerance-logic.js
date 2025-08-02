#!/usr/bin/env node

// Test to verify the tolerance logic is working correctly
const API_URL = 'https://guess5.onrender.com';

async function testToleranceLogic() {
  try {
    console.log('🔍 Testing tolerance logic...\n');
    
    const wallet1 = '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU';
    const wallet2 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
    
    const fee1 = 0.1235;
    const fee2 = 0.1268;
    const difference = Math.abs(fee1 - fee2);
    
    console.log('📊 Entry Fee Analysis:');
    console.log(`Player 1 fee: ${fee1} SOL`);
    console.log(`Player 2 fee: ${fee2} SOL`);
    console.log(`Difference: ${difference} SOL`);
    console.log(`Strict tolerance: 0.001 SOL`);
    console.log(`Flexible tolerance: 10%`);
    
    // Calculate flexible tolerance for fee2
    const flexibleMin = fee2 * 0.9;
    const flexibleMax = fee2 * 1.1;
    console.log(`Flexible range for ${fee2}: ${flexibleMin} - ${flexibleMax} SOL`);
    console.log(`Fee1 (${fee1}) within flexible range: ${fee1 >= flexibleMin && fee1 <= flexibleMax}`);
    
    // Test 1: Force cleanup
    console.log('\n1️⃣ Force cleanup both wallets...');
    await fetch(`${API_URL}/api/match/force-cleanup-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet1 })
    });
    
    await fetch(`${API_URL}/api/match/force-cleanup-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet2 })
    });
    
    // Test 2: Create player 1
    console.log('\n2️⃣ Creating player 1 with fee 0.1235...');
    const player1Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: wallet1, 
        entryFee: fee1
      })
    });
    
    const player1Result = await player1Request.json();
    console.log('Player 1 result:', player1Result);
    
    // Test 3: Create player 2
    console.log('\n3️⃣ Creating player 2 with fee 0.1268...');
    const player2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: wallet2, 
        entryFee: fee2
      })
    });
    
    const player2Result = await player2Request.json();
    console.log('Player 2 result:', player2Result);
    
    if (player2Result.status === 'matched') {
      console.log('\n🎉 SUCCESS: Players matched with different fees!');
      console.log('Tolerance logic is working correctly');
    } else {
      console.log('\n❌ FAILURE: Players did not match');
      console.log('This suggests the tolerance logic has an issue');
    }
    
    console.log('\n📋 SUMMARY:');
    console.log('- Entry fee difference:', difference, 'SOL');
    console.log('- Strict tolerance (0.001):', difference <= 0.001 ? '✅ Within' : '❌ Exceeds');
    console.log('- Flexible tolerance (10%):', difference <= (fee2 * 0.1) ? '✅ Within' : '❌ Exceeds');
    console.log('- Expected result: Should match with flexible tolerance');
    
  } catch (error) {
    console.error('❌ Error during test:', error);
  }
}

console.log('🚀 Testing tolerance logic...');
testToleranceLogic(); 
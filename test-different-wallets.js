const fetch = require('node-fetch');

// Test with different wallet addresses to simulate two different laptops
const wallet1 = '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU';
const wallet2 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';

async function testMatchmaking(wallet, entryFee = 0.1145) {
  try {
    console.log(`\n🔍 Testing matchmaking for wallet: ${wallet}`);
    
    const response = await fetch('https://guess5.onrender.com/api/match/request-match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        wallet: wallet,
        entryFee: entryFee
      }),
    });

    const data = await response.json();
    console.log(`📤 Response for ${wallet}:`, data);
    
    return data;
  } catch (error) {
    console.error(`❌ Error for ${wallet}:`, error.message);
    return null;
  }
}

async function runTest() {
  console.log('🧪 Testing matchmaking with different wallets...');
  
  // Test wallet 1 first
  const result1 = await testMatchmaking(wallet1);
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test wallet 2
  const result2 = await testMatchmaking(wallet2);
  
  console.log('\n📊 Test Results:');
  console.log(`Wallet 1 (${wallet1}):`, result1?.status || 'Failed');
  console.log(`Wallet 2 (${wallet2}):`, result2?.status || 'Failed');
  
  if (result1?.status === 'waiting' && result2?.status === 'matched') {
    console.log('✅ SUCCESS: Different wallets can match!');
  } else if (result1?.status === 'matched' && result2?.status === 'waiting') {
    console.log('✅ SUCCESS: Different wallets can match!');
  } else {
    console.log('❌ ISSUE: Both wallets got same status or failed');
  }
}

runTest().catch(console.error); 
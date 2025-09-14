const { RawSolanaClient } = require('./src/services/rawSolanaClient.js');

async function testRawClient() {
  console.log('🔍 Testing Raw Solana Client...');
  
  try {
    const client = new RawSolanaClient(
      'https://api.devnet.solana.com',
      '65sXkqxqChJhLAZ1PvsvvMzPd2NfYm2EZ1PPN4RX3q8H'
    );
    
    console.log('✅ Raw Solana Client initialized successfully');
    console.log('📋 Available methods:');
    console.log('  - getMatchAccount(address)');
    console.log('  - getVaultAccount(address)');
    console.log('  - createMatch(...)');
    console.log('  - settleMatch(...)');
    
    // Test with a dummy match account address
    const dummyAddress = '11111111111111111111111111111111';
    const matchData = await client.getMatchAccount(dummyAddress);
    console.log('📊 Test getMatchAccount result:', matchData);
    
  } catch (error) {
    console.error('❌ Raw Solana Client test failed:', error.message);
  }
}

testRawClient();

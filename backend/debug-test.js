const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

async function debugTest() {
  console.log('🔍 Debug Test Starting...');

  try {
  // Test 1: Basic imports
  console.log('1. Testing imports...');
  console.log('✅ Imports successful');

  // Test 2: Connection
  console.log('2. Testing connection...');
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  console.log('✅ Connection created');

  // Test 3: ManualSolanaClient import
  console.log('3. Testing ManualSolanaClient import...');
  const { ManualSolanaClient } = require('./src/services/manualSolanaClient');
  console.log('✅ ManualSolanaClient imported');

  // Test 4: Create client
  console.log('4. Testing client creation...');
  const manualClient = new ManualSolanaClient(connection);
  console.log('✅ ManualSolanaClient created');

  // Test 5: Test connection
  console.log('5. Testing connection...');
  const isConnected = await manualClient.testConnection();
  console.log('✅ Connection test result:', isConnected);

  console.log('🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

debugTest().catch(console.error);

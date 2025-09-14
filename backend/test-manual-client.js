const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { ManualSolanaClient } = require('./src/services/manualSolanaClient.js');

async function testManualClient() {
  console.log('🧪 Testing Manual Solana Client...');
  
  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const client = new ManualSolanaClient(connection);
  
  try {
    // Test connection
    console.log('🔍 Testing connection...');
    const isConnected = await client.testConnection();
    console.log('✅ Connection test:', isConnected ? 'SUCCESS' : 'FAILED');
    
    if (!isConnected) {
      throw new Error('Failed to connect to smart contract');
    }
    
    // Generate test keypairs
    const player1 = Keypair.generate();
    const player2 = Keypair.generate();
    const payer = Keypair.generate();
    
    console.log('👥 Generated test keypairs:');
    console.log('  Player 1:', player1.publicKey.toString());
    console.log('  Player 2:', player2.publicKey.toString());
    console.log('  Payer:', payer.publicKey.toString());
    
    // Test PDA generation
    console.log('🔑 Testing PDA generation...');
    const stakeAmount = 1000000; // 0.001 SOL
    const matchAccount = client.getMatchAccountPDA(player1.publicKey, player2.publicKey, stakeAmount);
    const [vaultAccount, vaultBump] = client.getVaultAccountPDA(matchAccount);
    
    console.log('✅ Generated PDAs:');
    console.log('  Match Account:', matchAccount.toString());
    console.log('  Vault Account:', vaultAccount.toString());
    console.log('  Vault Bump:', vaultBump);
    
    console.log('🎉 Manual Solana Client test completed successfully!');
    console.log('📝 Note: To test actual transactions, you would need:');
    console.log('  1. Fund the test keypairs with SOL');
    console.log('  2. Calculate the correct instruction discriminators');
    console.log('  3. Test createMatch, deposit, and settleMatch functions');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testManualClient().catch(console.error);

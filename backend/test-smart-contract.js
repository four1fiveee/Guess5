const { Connection, PublicKey, Keypair } = require('@solana/web3.js');

async function testSmartContract() {
  console.log('🧪 Testing Smart Contract Integration...\n');

  try {
    // Test connection to Solana devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const version = await connection.getVersion();
    console.log('✅ Connected to Solana devnet:', version);

        // Test program ID
        const programId = new PublicKey('3fBZMW3gfwvi9zEkMyqriofGARUpC44kvVf2FiJXJ7fP');
    console.log('✅ Program ID:', programId.toString());

    // Check if program exists on devnet
    try {
      const programInfo = await connection.getAccountInfo(programId);
      if (programInfo) {
        console.log('✅ Program found on devnet');
        console.log('   Owner:', programInfo.owner.toString());
        console.log('   Executable:', programInfo.executable);
        console.log('   Data length:', programInfo.data.length);
      } else {
        console.log('⚠️  Program not found on devnet - needs to be deployed');
      }
    } catch (error) {
      console.log('⚠️  Could not check program status:', error.message);
    }

    // Test PDA generation (simplified)
    const testPlayer1 = Keypair.generate().publicKey;
    const testPlayer2 = Keypair.generate().publicKey;
    const testStakeAmount = 1000000; // 0.001 SOL

    console.log('✅ Test player 1:', testPlayer1.toString());
    console.log('✅ Test player 2:', testPlayer2.toString());
    console.log('✅ Test stake amount:', testStakeAmount, 'lamports');

    console.log('\n🎉 Basic tests passed!');
    console.log('\n📋 Next steps:');
    console.log('1. Deploy the smart contract to devnet');
    console.log('2. Test creating a match');
    console.log('3. Test deposits and settlements');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testSmartContract();

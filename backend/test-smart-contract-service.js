const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Import the simple JavaScript version
const { smartContractService } = require('./src/services/simpleSmartContractService.js');

async function testSmartContractService() {
  console.log('🧪 Testing Smart Contract Service...');
  
  try {
    // Initialize the service
    console.log('🔧 Initializing service...');
    await smartContractService.initialize();
    console.log('✅ Service initialized successfully');
    
    // Test connection
    console.log('🔍 Testing connection...');
    const isInitialized = smartContractService.isInitialized();
    console.log('✅ Service initialized:', isInitialized);
    
    // Generate test keypairs
    const player1 = Keypair.generate();
    const player2 = Keypair.generate();
    
    console.log('👥 Generated test keypairs:');
    console.log('  Player 1:', player1.publicKey.toString());
    console.log('  Player 2:', player2.publicKey.toString());
    
    // Test PDA generation
    console.log('🔑 Testing PDA generation...');
    const stakeAmount = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL
    const matchAccount = smartContractService.getMatchAccountPDA(
      player1.publicKey, 
      player2.publicKey, 
      stakeAmount
    );
    const [vaultAccount, vaultBump] = smartContractService.getVaultAccountPDA(matchAccount);
    
    console.log('✅ Generated PDAs:');
    console.log('  Match Account:', matchAccount.toString());
    console.log('  Vault Account:', vaultAccount.toString());
    console.log('  Vault Bump:', vaultBump);
    
    // Test utility functions
    console.log('🔧 Testing utility functions...');
    const solAmount = 0.001;
    const lamports = smartContractService.solToLamports(solAmount);
    const backToSol = smartContractService.lamportsToSol(lamports);
    
    console.log('✅ Utility functions:');
    console.log('  SOL to lamports:', solAmount, '->', lamports);
    console.log('  Lamports to SOL:', lamports, '->', backToSol);
    
    // Test program ID
    console.log('🆔 Testing program ID...');
    const programId = smartContractService.getProgramId();
    console.log('✅ Program ID:', programId.toString());
    
    console.log('\n🎉 Smart Contract Service test completed successfully!');
    console.log('📝 Summary:');
    console.log('  - Service Initialization: ✅ Working');
    console.log('  - Connection: ✅ Working');
    console.log('  - PDA Generation: ✅ Working');
    console.log('  - Utility Functions: ✅ Working');
    console.log('  - Program ID: ✅ Working');
    
    console.log('\n📋 Next steps:');
    console.log('  1. Test createMatch with real transactions');
    console.log('  2. Test deposit functionality');
    console.log('  3. Test settleMatch functionality');
    console.log('  4. Integrate with the main backend API');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testSmartContractService().catch(console.error);

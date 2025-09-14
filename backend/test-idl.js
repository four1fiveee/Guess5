const { Program } = require('@coral-xyz/anchor');
const { Connection, PublicKey } = require('@solana/web3.js');
const { AnchorProvider } = require('@coral-xyz/anchor');

// Import the IDL
const IDL = require('./smart-contract/target/idl/guess5_escrow.json');

const PROGRAM_ID = new PublicKey("65sXkqxqChJhLAZ1PvsvvMzPd2NfYm2EZ1PPN4RX3q8H");

async function testIdlInitialization() {
  try {
    console.log('🔍 Testing IDL initialization...');
    
    // Create a dummy connection and provider
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Create a dummy wallet
    const dummyWallet = {
      publicKey: new PublicKey("11111111111111111111111111111111"),
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs
    };
    
    const provider = new AnchorProvider(connection, dummyWallet, {});
    
    // Try to initialize the program with the embedded IDL
    console.log('🔧 Initializing program with embedded IDL...');
    const program = new Program(IDL, PROGRAM_ID, provider);
    
    console.log('✅ Program initialized successfully!');
    console.log('📋 Program details:', {
      programId: program.programId.toString(),
      hasInstructions: !!program.instruction,
      hasAccounts: !!program.account,
      instructionNames: Object.keys(program.instruction || {}),
      accountNames: Object.keys(program.account || {})
    });
    
    // Test if we can access the MatchResult type
    console.log('🔍 Testing MatchResult type access...');
    if (program.instruction && program.instruction.settleMatch) {
      console.log('✅ settleMatch instruction found');
      console.log('📋 settleMatch args:', program.instruction.settleMatch.args);
    } else {
      console.log('❌ settleMatch instruction not found');
    }
    
    return true;
  } catch (error) {
    console.error('❌ IDL initialization failed:', error);
    return false;
  }
}

// Run the test
testIdlInitialization()
  .then(success => {
    if (success) {
      console.log('🎉 IDL test passed! The embedded IDL is working correctly.');
      process.exit(0);
    } else {
      console.log('💥 IDL test failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });

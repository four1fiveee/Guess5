const { Program } = require('@coral-xyz/anchor');
const { Connection, PublicKey } = require('@solana/web3.js');
const { AnchorProvider } = require('@coral-xyz/anchor');
const fs = require('fs');

const PROGRAM_ID = new PublicKey("65sXkqxqChJhLAZ1PvsvvMzPd2NfYm2EZ1PPN4RX3q8H");

async function testAlternativeIdlApproach() {
  try {
    console.log('🔍 Testing alternative IDL approach...');
    
    // Create a dummy connection and provider
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Create a dummy wallet
    const dummyWallet = {
      publicKey: new PublicKey("11111111111111111111111111111111"),
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs
    };
    
    const provider = new AnchorProvider(connection, dummyWallet, {});
    
    // Try approach 1: Load IDL as raw object
    console.log('🔧 Approach 1: Loading IDL as raw object...');
    const idlPath = './smart-contract/target/idl/guess5_escrow_corrected.json';
    const rawIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    
    try {
      const program1 = new Program(rawIdl, PROGRAM_ID, provider);
      console.log('✅ Approach 1 succeeded!');
      return true;
    } catch (error) {
      console.log('❌ Approach 1 failed:', error.message);
    }
    
    // Try approach 2: Use the original IDL but with a workaround
    console.log('🔧 Approach 2: Using original IDL with workaround...');
    const originalIdlPath = './smart-contract/target/idl/guess5_escrow.json';
    const originalIdl = JSON.parse(fs.readFileSync(originalIdlPath, 'utf8'));
    
    try {
      const program2 = new Program(originalIdl, PROGRAM_ID, provider);
      console.log('✅ Approach 2 succeeded!');
      return true;
    } catch (error) {
      console.log('❌ Approach 2 failed:', error.message);
    }
    
    // Try approach 3: Create a minimal IDL without the problematic instruction
    console.log('🔧 Approach 3: Creating minimal IDL without settle_match...');
    const minimalIdl = {
      ...rawIdl,
      instructions: rawIdl.instructions.filter(ix => ix.name !== 'settle_match')
    };
    
    try {
      const program3 = new Program(minimalIdl, PROGRAM_ID, provider);
      console.log('✅ Approach 3 succeeded! (without settle_match)');
      console.log('📋 Available instructions:', Object.keys(program3.instruction || {}));
      return true;
    } catch (error) {
      console.log('❌ Approach 3 failed:', error.message);
    }
    
    // Try approach 4: Check if it's a version issue
    console.log('🔧 Approach 4: Checking Anchor version...');
    const anchorVersion = require('@coral-xyz/anchor/package.json').version;
    console.log('📋 Anchor version:', anchorVersion);
    
    return false;
  } catch (error) {
    console.error('❌ Test crashed:', error);
    return false;
  }
}

// Run the test
testAlternativeIdlApproach()
  .then(success => {
    if (success) {
      console.log('🎉 Alternative approach found!');
      process.exit(0);
    } else {
      console.log('💥 All approaches failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });


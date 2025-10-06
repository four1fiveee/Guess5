const { Program } = require('@coral-xyz/anchor');
const { Connection, PublicKey } = require('@solana/web3.js');
const { AnchorProvider } = require('@coral-xyz/anchor');

const PROGRAM_ID = new PublicKey("65sXkqxqChJhLAZ1PvsvvMzPd2NfYm2EZ1PPN4RX3q8H");

async function testMinimalIdl() {
  try {
    console.log('🔍 Testing minimal IDL...');
    
    // Create a dummy connection and provider
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Create a dummy wallet
    const dummyWallet = {
      publicKey: new PublicKey("11111111111111111111111111111111"),
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs
    };
    
    const provider = new AnchorProvider(connection, dummyWallet, {});
    
    // Create a minimal IDL with just the MatchResult type and one instruction
    const minimalIdl = {
      "address": PROGRAM_ID.toString(),
      "metadata": {
        "name": "guess5_escrow",
        "version": "0.1.0",
        "spec": "0.1.0"
      },
      "types": [
        {
          "name": "MatchResult",
          "type": {
            "kind": "enum",
            "variants": [
              { "name": "Player1" },
              { "name": "Player2" },
              { "name": "WinnerTie" },
              { "name": "LosingTie" },
              { "name": "Timeout" },
              { "name": "Error" }
            ]
          }
        }
      ],
      "instructions": [
        {
          "name": "settle_match",
          "discriminator": [71, 124, 117, 96, 191, 217, 116, 24],
          "accounts": [],
          "args": [
            {
              "name": "result",
              "type": {
                "defined": {
                  "name": "MatchResult"
                }
              }
            }
          ]
        }
      ],
      "accounts": [],
      "events": [],
      "errors": []
    };
    
    console.log('🔧 Testing minimal IDL with MatchResult type...');
    const program = new Program(minimalIdl, PROGRAM_ID, provider);
    console.log('✅ Minimal IDL succeeded!');
    
    // Test if we can access the instruction
    if (program.instruction && program.instruction.settleMatch) {
      console.log('✅ settleMatch instruction accessible');
      console.log('📋 settleMatch args:', program.instruction.settleMatch.args);
    } else {
      console.log('❌ settleMatch instruction not accessible');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Minimal IDL failed:', error.message);
    return false;
  }
}

// Run the test
testMinimalIdl()
  .then(success => {
    if (success) {
      console.log('🎉 Minimal IDL test passed!');
      process.exit(0);
    } else {
      console.log('💥 Minimal IDL test failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });




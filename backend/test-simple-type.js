const { Program } = require('@coral-xyz/anchor');
const { Connection, PublicKey } = require('@solana/web3.js');
const { AnchorProvider } = require('@coral-xyz/anchor');

const PROGRAM_ID = new PublicKey("65sXkqxqChJhLAZ1PvsvvMzPd2NfYm2EZ1PPN4RX3q8H");

async function testSimpleType() {
  try {
    console.log('🔍 Testing simple type in IDL...');
    
    // Create a dummy connection and provider
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Create a dummy wallet
    const dummyWallet = {
      publicKey: new PublicKey("11111111111111111111111111111111"),
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs
    };
    
    const provider = new AnchorProvider(connection, dummyWallet, {});
    
    // Test 1: Simple struct type
    console.log('🔧 Test 1: Simple struct type...');
    const structIdl = {
      "address": PROGRAM_ID.toString(),
      "metadata": {
        "name": "guess5_escrow",
        "version": "0.1.0",
        "spec": "0.1.0"
      },
      "types": [
        {
          "name": "SimpleStruct",
          "type": {
            "kind": "struct",
            "fields": [
              {
                "name": "value",
                "type": "u64"
              }
            ]
          }
        }
      ],
      "instructions": [
        {
          "name": "test_struct",
          "discriminator": [1, 2, 3, 4, 5, 6, 7, 8],
          "accounts": [],
          "args": [
            {
              "name": "data",
              "type": {
                "defined": {
                  "name": "SimpleStruct"
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
    
    try {
      const program1 = new Program(structIdl, PROGRAM_ID, provider);
      console.log('✅ Test 1 succeeded with struct type!');
    } catch (error) {
      console.log('❌ Test 1 failed:', error.message);
    }
    
    // Test 2: Simple enum type
    console.log('🔧 Test 2: Simple enum type...');
    const enumIdl = {
      "address": PROGRAM_ID.toString(),
      "metadata": {
        "name": "guess5_escrow",
        "version": "0.1.0",
        "spec": "0.1.0"
      },
      "types": [
        {
          "name": "SimpleEnum",
          "type": {
            "kind": "enum",
            "variants": [
              { "name": "Option1" },
              { "name": "Option2" }
            ]
          }
        }
      ],
      "instructions": [
        {
          "name": "test_enum",
          "discriminator": [1, 2, 3, 4, 5, 6, 7, 8],
          "accounts": [],
          "args": [
            {
              "name": "choice",
              "type": {
                "defined": {
                  "name": "SimpleEnum"
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
    
    try {
      const program2 = new Program(enumIdl, PROGRAM_ID, provider);
      console.log('✅ Test 2 succeeded with enum type!');
    } catch (error) {
      console.log('❌ Test 2 failed:', error.message);
    }
    
    // Test 3: No custom types at all
    console.log('🔧 Test 3: No custom types...');
    const noTypesIdl = {
      "address": PROGRAM_ID.toString(),
      "metadata": {
        "name": "guess5_escrow",
        "version": "0.1.0",
        "spec": "0.1.0"
      },
      "types": [],
      "instructions": [
        {
          "name": "test_simple",
          "discriminator": [1, 2, 3, 4, 5, 6, 7, 8],
          "accounts": [],
          "args": [
            {
              "name": "value",
              "type": "u64"
            }
          ]
        }
      ],
      "accounts": [],
      "events": [],
      "errors": []
    };
    
    try {
      const program3 = new Program(noTypesIdl, PROGRAM_ID, provider);
      console.log('✅ Test 3 succeeded with no custom types!');
    } catch (error) {
      console.log('❌ Test 3 failed:', error.message);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Test crashed:', error);
    return false;
  }
}

// Run the test
testSimpleType()
  .then(success => {
    console.log('🎉 Simple type tests completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });




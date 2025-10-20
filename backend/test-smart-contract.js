const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@coral-xyz/anchor');
const fs = require('fs');
const path = require('path');

// Load the IDL
const IDL_PATH = path.join(__dirname, 'smart-contract/target/idl/guess5_escrow.json');
let IDL;
try {
  IDL = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
} catch (error) {
  console.error('❌ Could not load IDL. Make sure to build the smart contract first.');
  console.error('Run: cd smart-contract && anchor build');
  process.exit(1);
}

async function testSmartContract() {
  console.log('🧪 Testing Smart Contract Integration...\n');

  // Configuration
  const PROGRAM_ID = process.env.SMART_CONTRACT_PROGRAM_ID || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4';
  const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  
  try {
    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');
    console.log(`🔗 Connected to: ${RPC_URL}`);

    // Initialize program
    const programId = new PublicKey(PROGRAM_ID);
    const provider = new AnchorProvider(
      connection,
      new Wallet(Keypair.generate()), // Dummy wallet for read operations
      { commitment: 'confirmed' }
    );

    const program = new Program(IDL, programId, provider);
    console.log(`📋 Program ID: ${PROGRAM_ID}`);

    // Test 1: Check if program exists
    console.log('\n📊 Test 1: Checking if program exists...');
    try {
      const programInfo = await connection.getAccountInfo(programId);
      if (programInfo) {
        console.log('✅ Program exists on-chain');
        console.log(`   Owner: ${programInfo.owner.toString()}`);
        console.log(`   Executable: ${programInfo.executable}`);
        console.log(`   Data length: ${programInfo.data.length} bytes`);
      } else {
        console.log('❌ Program not found on-chain');
        console.log('   Make sure to deploy the smart contract first');
        return;
      }
    } catch (error) {
      console.log('❌ Error checking program:', error.message);
      return;
    }

    // Test 2: Check connection health
    console.log('\n📊 Test 2: Checking connection health...');
    try {
      const version = await connection.getVersion();
      console.log('✅ Connection healthy');
      console.log(`   Solana version: ${version['solana-core']}`);
      
      const slot = await connection.getSlot();
      console.log(`   Current slot: ${slot}`);
    } catch (error) {
      console.log('❌ Connection error:', error.message);
      return;
    }

    // Test 3: Check environment variables
    console.log('\n📊 Test 3: Checking environment variables...');
    const requiredEnvVars = [
      'SMART_CONTRACT_PROGRAM_ID',
      'RESULTS_ATTESTOR_PUBKEY',
      'FEE_WALLET_ADDRESS'
    ];

    let envVarsOk = true;
    requiredEnvVars.forEach(envVar => {
      if (process.env[envVar]) {
        console.log(`✅ ${envVar}: ${process.env[envVar]}`);
      } else {
        console.log(`❌ ${envVar}: Not set`);
        envVarsOk = false;
      }
    });

    if (!envVarsOk) {
      console.log('\n⚠️  Some environment variables are missing.');
      console.log('   Make sure to set them in your .env file');
    }

    // Test 4: Test PDA derivation
    console.log('\n📊 Test 4: Testing PDA derivation...');
    try {
      const testPlayer1 = Keypair.generate().publicKey;
      const testPlayer2 = Keypair.generate().publicKey;
      const testStakeAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

      const [matchPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('match'),
          testPlayer1.toBuffer(),
          testPlayer2.toBuffer(),
          testStakeAmount.toArrayLike(Buffer, 'le', 8)
        ],
        programId
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchPda.toBuffer()],
        programId
      );

      console.log('✅ PDA derivation working');
      console.log(`   Match PDA: ${matchPda.toString()}`);
      console.log(`   Vault PDA: ${vaultPda.toString()}`);
    } catch (error) {
      console.log('❌ PDA derivation error:', error.message);
    }

    // Test 5: Check fee wallet balance
    console.log('\n📊 Test 5: Checking fee wallet balance...');
    try {
      const feeWalletAddress = process.env.FEE_WALLET_ADDRESS;
      if (feeWalletAddress) {
        const feeWalletPubkey = new PublicKey(feeWalletAddress);
        const balance = await connection.getBalance(feeWalletPubkey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;
        
        console.log(`✅ Fee wallet balance: ${balanceSOL.toFixed(4)} SOL`);
        
        if (balance < 0.01 * LAMPORTS_PER_SOL) {
          console.log('⚠️  Fee wallet has low balance. Consider requesting airdrop.');
        }
      } else {
        console.log('❌ FEE_WALLET_ADDRESS not set');
      }
    } catch (error) {
      console.log('❌ Error checking fee wallet:', error.message);
    }

    console.log('\n🎉 Smart Contract Integration Test Complete!');
    console.log('\n📋 Next Steps:');
    console.log('1. If all tests passed, your smart contract is ready');
    console.log('2. Test creating matches via the backend API');
    console.log('3. Test player deposits and match settlements');
    console.log('4. When ready, deploy to mainnet');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the smart contract is deployed');
    console.log('2. Check your environment variables');
    console.log('3. Verify your Solana CLI configuration');
    console.log('4. Run: cd smart-contract && anchor build && anchor deploy');
  }
}

// Run the test
testSmartContract();


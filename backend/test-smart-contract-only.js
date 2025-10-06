const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ManualSolanaClient } = require('./src/services/manualSolanaClient');
const bs58 = require('bs58');

// Configuration
const FEE_WALLET_PRIVATE_KEY = "27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe";

async function testSmartContractOnly() {
  console.log('🧪 Testing Smart Contract (No Airdrop)\n');

  try {
    // Create connection
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const manualClient = new ManualSolanaClient(connection);

    // Test 1: Connection
    console.log('1. Testing connection...');
    const isConnected = await manualClient.testConnection();
    if (!isConnected) {
      throw new Error('❌ Failed to connect to Solana network');
    }
    console.log('✅ Connection successful\n');

    // Test 2: Generate test accounts
    console.log('2. Setting up test accounts...');
    const player1 = Keypair.generate();
    const player2 = Keypair.generate();
    
    // Create fee wallet from private key
    const feeWallet = Keypair.fromSecretKey(
      bs58.decode(FEE_WALLET_PRIVATE_KEY)
    );

    console.log(`   Player 1: ${player1.publicKey.toString()}`);
    console.log(`   Player 2: ${player2.publicKey.toString()}`);
    console.log(`   Fee Wallet: ${feeWallet.publicKey.toString()}\n`);

    // Test 3: Check account balances
    console.log('3. Checking account balances...');
    try {
      const player1Balance = await connection.getBalance(player1.publicKey);
      const player2Balance = await connection.getBalance(player2.publicKey);
      const feeWalletBalance = await connection.getBalance(feeWallet.publicKey);
      
      console.log(`   Player 1 Balance: ${player1Balance / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Player 2 Balance: ${player2Balance / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Fee Wallet Balance: ${feeWalletBalance / LAMPORTS_PER_SOL} SOL\n`);
      
      if (feeWalletBalance < 0.01 * LAMPORTS_PER_SOL) {
        console.log('⚠️ Fee wallet has insufficient balance for testing');
        console.log('   You may need to fund it manually or request an airdrop\n');
      }
    } catch (error) {
      console.log(`❌ Failed to check balances: ${error.message}\n`);
    }

    // Test 4: Generate match account PDA
    console.log('4. Testing PDA generation...');
    const stakeAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
    const matchAccount = manualClient.getMatchAccountPDA(
      player1.publicKey,
      player2.publicKey,
      stakeAmount
    );
    console.log(`✅ Match Account PDA: ${matchAccount.toString()}`);
    
    const [vaultAccount] = manualClient.getVaultAccountPDA(matchAccount);
    console.log(`✅ Vault Account PDA: ${vaultAccount.toString()}\n`);

    // Test 5: Check if match account exists
    console.log('5. Checking if match account exists...');
    try {
      const matchAccountInfo = await connection.getAccountInfo(matchAccount);
      if (matchAccountInfo) {
        console.log('✅ Match account already exists');
        console.log(`   Owner: ${matchAccountInfo.owner.toString()}`);
        console.log(`   Data Length: ${matchAccountInfo.data.length} bytes\n`);
      } else {
        console.log('ℹ️ Match account does not exist yet (this is normal)\n');
      }
    } catch (error) {
      console.log(`❌ Failed to check match account: ${error.message}\n`);
    }

    // Test 6: Test match creation (if we have enough balance)
    console.log('6. Testing match creation...');
    try {
      const feeWalletBalance = await connection.getBalance(feeWallet.publicKey);
      if (feeWalletBalance < 0.01 * LAMPORTS_PER_SOL) {
        console.log('⚠️ Skipping match creation - insufficient balance in fee wallet');
        console.log('   Fee wallet needs at least 0.01 SOL for transaction fees\n');
      } else {
        const feeBps = 500; // 5%
        const currentSlot = await connection.getSlot();
        const deadlineSlot = currentSlot + (24 * 60 * 60 * 2); // 24 hours

        console.log('   Creating match...');
        const signature = await manualClient.createMatch(
          player1.publicKey,
          player2.publicKey,
          stakeAmount,
          feeBps,
          deadlineSlot,
          feeWallet
        );
        
        console.log(`✅ Match created successfully: ${signature}\n`);
      }
    } catch (error) {
      console.log(`❌ Match creation failed: ${error.message}\n`);
    }

    console.log('🎉 Smart contract test completed!');
    console.log('\nNext steps:');
    console.log('1. Fund the fee wallet with some SOL for testing');
    console.log('2. Run the full integration test with airdrop');
    console.log('3. Test the complete match flow');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testSmartContractOnly().catch(console.error);

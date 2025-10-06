const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ManualSolanaClient } = require('./src/services/manualSolanaClient');
const bs58 = require('bs58');

// Configuration
const PROGRAM_ID = "rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X";
const FEE_WALLET_PRIVATE_KEY = "27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe";

async function testIntegration() {
  console.log('🧪 Testing Smart Contract Integration (Simple Version)\n');

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

    // Test 3: Request airdrop
    console.log('3. Requesting airdrop...');
    try {
      await connection.requestAirdrop(player1.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(player2.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(feeWallet.publicKey, 1 * LAMPORTS_PER_SOL);
      
      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('✅ Airdrop completed\n');
    } catch (error) {
      console.log('⚠️ Airdrop failed, continuing...\n');
    }

    // Test 4: Create match
    console.log('4. Creating match...');
    const stakeAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
    const feeBps = 500; // 5%
    const currentSlot = await connection.getSlot();
    const deadlineSlot = currentSlot + (24 * 60 * 60 * 2); // 24 hours

    try {
      const signature = await manualClient.createMatch(
        player1.publicKey,
        player2.publicKey,
        stakeAmount,
        feeBps,
        deadlineSlot,
        feeWallet
      );
      
      console.log(`✅ Match created: ${signature}`);
      
      // Get match account
      const matchAccount = manualClient.getMatchAccountPDA(
        player1.publicKey,
        player2.publicKey,
        stakeAmount
      );
      console.log(`   Match Account: ${matchAccount.toString()}\n`);

      // Test 5: Player 1 deposit
      console.log('5. Testing Player 1 deposit...');
      try {
        const depositSig1 = await manualClient.deposit(matchAccount, player1, stakeAmount);
        console.log(`✅ Player 1 deposited: ${depositSig1}\n`);
      } catch (error) {
        console.log(`❌ Player 1 deposit failed: ${error.message}\n`);
      }

      // Test 6: Player 2 deposit
      console.log('6. Testing Player 2 deposit...');
      try {
        const depositSig2 = await manualClient.deposit(matchAccount, player2, stakeAmount);
        console.log(`✅ Player 2 deposited: ${depositSig2}\n`);
      } catch (error) {
        console.log(`❌ Player 2 deposit failed: ${error.message}\n`);
      }

      // Test 7: Check match status
      console.log('7. Checking match status...');
      try {
        const matchData = await manualClient.getMatchData(matchAccount);
        console.log('✅ Match data:');
        console.log(`   Status: ${matchData.status}`);
        console.log(`   Player 1 Deposited: ${matchData.player1Deposited.toString()}`);
        console.log(`   Player 2 Deposited: ${matchData.player2Deposited.toString()}\n`);
      } catch (error) {
        console.log(`❌ Failed to get match data: ${error.message}\n`);
      }

      // Test 8: Settle match (Player 1 wins)
      console.log('8. Settling match...');
      try {
        const [vaultAccount] = manualClient.getVaultAccountPDA(matchAccount);
        const settleSig = await manualClient.settleMatch(
          matchAccount,
          vaultAccount,
          0, // Player1 wins
          feeWallet
        );
        console.log(`✅ Match settled: ${settleSig}\n`);
      } catch (error) {
        console.log(`❌ Match settlement failed: ${error.message}\n`);
      }

    } catch (error) {
      console.log(`❌ Match creation failed: ${error.message}\n`);
    }

    console.log('🎉 Integration test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testIntegration().catch(console.error);

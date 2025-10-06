const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ManualSolanaClient } = require('./src/services/manualSolanaClient');

// Test configuration
const PROGRAM_ID = new PublicKey("rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X");
const FEE_WALLET_ADDRESS = "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt";

// Create connection to devnet
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function testSmartContractIntegration() {
  console.log('🧪 Testing Smart Contract Integration...\n');

  try {
    // Initialize manual client
    const manualClient = new ManualSolanaClient(connection);
    
    // Test connection
    console.log('1. Testing connection...');
    const isConnected = await manualClient.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to Solana network');
    }
    console.log('✅ Connection successful\n');

    // Generate test keypairs
    const player1 = Keypair.generate();
    const player2 = Keypair.generate();
    const feeWallet = Keypair.fromSecretKey(
      Buffer.from(process.env.FEE_WALLET_PRIVATE_KEY, 'base64')
    );

    console.log('2. Generated test accounts:');
    console.log(`   Player 1: ${player1.publicKey.toString()}`);
    console.log(`   Player 2: ${player2.publicKey.toString()}`);
    console.log(`   Fee Wallet: ${feeWallet.publicKey.toString()}\n`);

    // Request airdrop for test accounts
    console.log('3. Requesting airdrop for test accounts...');
    const airdropAmount = 1 * LAMPORTS_PER_SOL; // 1 SOL
    
    try {
      await connection.requestAirdrop(player1.publicKey, airdropAmount);
      await connection.requestAirdrop(player2.publicKey, airdropAmount);
      await connection.requestAirdrop(feeWallet.publicKey, airdropAmount);
      
      // Wait for airdrops to confirm
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('✅ Airdrop completed\n');
    } catch (error) {
      console.log('⚠️ Airdrop failed, but continuing with test...\n');
    }

    // Test match creation
    console.log('4. Testing match creation...');
    const stakeAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
    const feeBps = 500; // 5%
    
    // Calculate deadline (24 hours from now)
    const currentSlot = await connection.getSlot();
    const deadlineSlot = currentSlot + (24 * 60 * 60 * 2); // 24 hours in slots

    try {
      const signature = await manualClient.createMatch(
        player1.publicKey,
        player2.publicKey,
        stakeAmount,
        feeBps,
        deadlineSlot,
        feeWallet
      );
      
      console.log(`✅ Match created successfully: ${signature}`);
      
      // Get match account PDA
      const matchAccount = manualClient.getMatchAccountPDA(
        player1.publicKey,
        player2.publicKey,
        stakeAmount
      );
      
      console.log(`   Match Account: ${matchAccount.toString()}`);
      
      // Get vault account PDA
      const [vaultAccount] = manualClient.getVaultAccountPDA(matchAccount);
      console.log(`   Vault Account: ${vaultAccount.toString()}\n`);

      // Test deposit from player 1
      console.log('5. Testing player 1 deposit...');
      try {
        const depositSignature1 = await manualClient.deposit(
          matchAccount,
          player1,
          stakeAmount
        );
        console.log(`✅ Player 1 deposit successful: ${depositSignature1}\n`);
      } catch (error) {
        console.log(`❌ Player 1 deposit failed: ${error.message}\n`);
      }

      // Test deposit from player 2
      console.log('6. Testing player 2 deposit...');
      try {
        const depositSignature2 = await manualClient.deposit(
          matchAccount,
          player2,
          stakeAmount
        );
        console.log(`✅ Player 2 deposit successful: ${depositSignature2}\n`);
      } catch (error) {
        console.log(`❌ Player 2 deposit failed: ${error.message}\n`);
      }

      // Test getting match data
      console.log('7. Testing match data retrieval...');
      try {
        const matchData = await manualClient.getMatchData(matchAccount);
        console.log('✅ Match data retrieved:');
        console.log(`   Player 1: ${matchData.player1.toString()}`);
        console.log(`   Player 2: ${matchData.player2.toString()}`);
        console.log(`   Stake Amount: ${matchData.stakeAmount.toString()}`);
        console.log(`   Status: ${matchData.status}`);
        console.log(`   Player 1 Deposited: ${matchData.player1Deposited.toString()}`);
        console.log(`   Player 2 Deposited: ${matchData.player2Deposited.toString()}\n`);
      } catch (error) {
        console.log(`❌ Failed to get match data: ${error.message}\n`);
      }

      // Test getting vault data
      console.log('8. Testing vault data retrieval...');
      try {
        const vaultData = await manualClient.getVaultData(vaultAccount);
        console.log('✅ Vault data retrieved:');
        console.log(`   Match Account: ${vaultData.matchAccount.toString()}`);
        console.log(`   Total Deposited: ${vaultData.totalDeposited.toString()}`);
        console.log(`   Bump: ${vaultData.bump}\n`);
      } catch (error) {
        console.log(`❌ Failed to get vault data: ${error.message}\n`);
      }

      // Test settling match (Player 1 wins)
      console.log('9. Testing match settlement...');
      try {
        const settleSignature = await manualClient.settleMatch(
          matchAccount,
          vaultAccount,
          0, // Player1 wins (MatchResult::Player1 = 0)
          feeWallet
        );
        console.log(`✅ Match settled successfully: ${settleSignature}\n`);
      } catch (error) {
        console.log(`❌ Match settlement failed: ${error.message}\n`);
      }

    } catch (error) {
      console.log(`❌ Match creation failed: ${error.message}\n`);
    }

    console.log('🎉 Smart contract integration test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testSmartContractIntegration().catch(console.error);

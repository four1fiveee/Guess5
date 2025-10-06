const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ManualSolanaClient } = require('./src/services/manualSolanaClient.js');

async function testTransactions() {
  console.log('🧪 Testing Smart Contract Transactions...');
  
  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const client = new ManualSolanaClient(connection);
  
  try {
    // Test connection
    console.log('🔍 Testing connection...');
    const isConnected = await client.testConnection();
    console.log('✅ Connection test:', isConnected ? 'SUCCESS' : 'FAILED');
    
    if (!isConnected) {
      throw new Error('Failed to connect to smart contract');
    }
    
    // Generate test keypairs
    const player1 = Keypair.generate();
    const player2 = Keypair.generate();
    const payer = Keypair.generate();
    
    console.log('👥 Generated test keypairs:');
    console.log('  Player 1:', player1.publicKey.toString());
    console.log('  Player 2:', player2.publicKey.toString());
    console.log('  Payer:', payer.publicKey.toString());
    
    // Request airdrop for payer (we need SOL to pay for transactions)
    console.log('💰 Requesting airdrop for payer...');
    try {
      const airdropSignature = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(airdropSignature);
      console.log('✅ Airdrop successful');
    } catch (airdropError) {
      console.log('⚠️  Airdrop failed, but continuing with test...');
    }
    
    // Check payer balance
    const payerBalance = await connection.getBalance(payer.publicKey);
    console.log('💰 Payer balance:', payerBalance / LAMPORTS_PER_SOL, 'SOL');
    
    if (payerBalance < 0.1 * LAMPORTS_PER_SOL) {
      console.log('⚠️  Insufficient balance for testing. Please fund the payer manually.');
      console.log('   Payer address:', payer.publicKey.toString());
      return;
    }
    
    // Test parameters
    const stakeAmount = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL
    const feeBps = 500; // 5%
    const deadlineSlot = (await connection.getSlot()) + 1000; // 1000 slots from now
    
    console.log('📋 Test parameters:');
    console.log('  Stake amount:', stakeAmount / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Fee (bps):', feeBps);
    console.log('  Deadline slot:', deadlineSlot);
    
    // Generate PDAs
    console.log('🔑 Generating PDAs...');
    const matchAccount = client.getMatchAccountPDA(player1.publicKey, player2.publicKey, stakeAmount);
    const [vaultAccount, vaultBump] = client.getVaultAccountPDA(matchAccount);
    
    console.log('✅ Generated PDAs:');
    console.log('  Match Account:', matchAccount.toString());
    console.log('  Vault Account:', vaultAccount.toString());
    console.log('  Vault Bump:', vaultBump);
    
    // Test 1: Create Match
    console.log('\n🎯 Test 1: Creating match...');
    try {
      const createSignature = await client.createMatch(
        player1.publicKey,
        player2.publicKey,
        stakeAmount,
        feeBps,
        deadlineSlot,
        payer
      );
      console.log('✅ Create match successful!');
      console.log('  Signature:', createSignature);
      
      // Wait a moment for the transaction to be confirmed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (createError) {
      console.log('❌ Create match failed:', createError.message);
      console.log('   This might be expected if the instruction format is incorrect');
    }
    
    // Test 2: Check if match account exists
    console.log('\n🔍 Test 2: Checking match account...');
    try {
      const matchAccountInfo = await connection.getAccountInfo(matchAccount);
      if (matchAccountInfo) {
        console.log('✅ Match account exists!');
        console.log('  Data length:', matchAccountInfo.data.length, 'bytes');
        console.log('  Owner:', matchAccountInfo.owner.toString());
        
        // Try to deserialize match data
        try {
          const matchData = await client.getMatchData(matchAccount);
          console.log('✅ Match data deserialized successfully!');
          console.log('  Player 1:', new PublicKey(matchData.player1).toString());
          console.log('  Player 2:', new PublicKey(matchData.player2).toString());
          console.log('  Stake amount:', matchData.stakeAmount.toString());
          console.log('  Fee bps:', matchData.feeBps);
          console.log('  Status:', matchData.status);
        } catch (deserializeError) {
          console.log('⚠️  Could not deserialize match data:', deserializeError.message);
        }
      } else {
        console.log('❌ Match account does not exist');
      }
    } catch (checkError) {
      console.log('❌ Error checking match account:', checkError.message);
    }
    
    // Test 3: Check vault account
    console.log('\n🔍 Test 3: Checking vault account...');
    try {
      const vaultAccountInfo = await connection.getAccountInfo(vaultAccount);
      if (vaultAccountInfo) {
        console.log('✅ Vault account exists!');
        console.log('  Data length:', vaultAccountInfo.data.length, 'bytes');
        console.log('  Owner:', vaultAccountInfo.owner.toString());
        console.log('  Balance:', vaultAccountInfo.lamports / LAMPORTS_PER_SOL, 'SOL');
      } else {
        console.log('❌ Vault account does not exist');
      }
    } catch (vaultError) {
      console.log('❌ Error checking vault account:', vaultError.message);
    }
    
    console.log('\n🎉 Transaction testing completed!');
    console.log('📝 Summary:');
    console.log('  - Connection: ✅ Working');
    console.log('  - PDA Generation: ✅ Working');
    console.log('  - Transaction Creation: ⚠️  May need instruction format adjustments');
    console.log('  - Account Creation: ⚠️  Depends on successful transaction');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testTransactions().catch(console.error);




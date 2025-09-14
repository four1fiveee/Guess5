const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { ManualSolanaClient } = require('./src/services/manualSolanaClient.js');

async function testSimpleTransaction() {
  console.log('🧪 Testing Simple Transaction...');
  
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
    const payer = Keypair.generate();
    
    console.log('👤 Generated test keypair:');
    console.log('  Payer:', payer.publicKey.toString());
    
    // Request airdrop for payer
    console.log('💰 Requesting airdrop for payer...');
    try {
      const airdropSignature = await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
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
    
    console.log('\n🎯 Testing initialize instruction...');
    
    // Create a simple initialize instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      ],
      programId: new PublicKey("rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X"),
      data: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]), // initialize discriminator
    });
    
    // Create and send transaction
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      { commitment: 'confirmed' }
    );
    
    console.log('✅ Initialize transaction successful!');
    console.log('  Signature:', signature);
    
    console.log('\n🎉 Simple transaction test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Import sendAndConfirmTransaction
const { sendAndConfirmTransaction } = require('@solana/web3.js');

// Run the test
testSimpleTransaction().catch(console.error);

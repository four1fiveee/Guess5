const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

async function deployExistingProgram() {
  console.log('🚀 Deploying existing program to devnet...\n');

  try {
    // Connect to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    console.log('✅ Connected to Solana devnet');

    // Load the program keypair
    const programKeypairPath = path.join(__dirname, 'guess5-escrow', 'target', 'deploy', 'guess5_escrow-keypair.json');
    
    if (!fs.existsSync(programKeypairPath)) {
      console.error('❌ Program keypair not found at:', programKeypairPath);
      console.log('Please ensure the keypair exists or generate a new one.');
      return;
    }

    const programKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(programKeypairPath, 'utf8')))
    );
    
    console.log('✅ Program keypair loaded');
    console.log('   Program ID:', programKeypair.publicKey.toString());

    // Load the program binary
    const programSoPath = path.join(__dirname, 'guess5-escrow', 'program.so');
    
    if (!fs.existsSync(programSoPath)) {
      console.error('❌ Program binary not found at:', programSoPath);
      return;
    }

    const programBuffer = fs.readFileSync(programSoPath);
    console.log('✅ Program binary loaded');
    console.log('   Size:', programBuffer.length, 'bytes');

    // Check if program already exists
    const programInfo = await connection.getAccountInfo(programKeypair.publicKey);
    if (programInfo) {
      console.log('⚠️  Program already exists on devnet');
      console.log('   Owner:', programInfo.owner.toString());
      console.log('   Executable:', programInfo.executable);
      console.log('   Data length:', programInfo.data.length);
      
      if (programInfo.executable) {
        console.log('✅ Program is already deployed and executable');
        return;
      }
    }

    // For deployment, we need a payer keypair
    // In a real deployment, you would use your wallet keypair
    console.log('⚠️  To deploy, you need to:');
    console.log('1. Set up your wallet keypair');
    console.log('2. Fund it with SOL on devnet');
    console.log('3. Use solana program deploy command');
    
    console.log('\n📋 Manual deployment steps:');
    console.log('1. solana config set --url devnet');
    console.log('2. solana airdrop 2 (if needed)');
    console.log('3. solana program deploy target/deploy/guess5_escrow.so');

  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the deployment
deployExistingProgram();

/**
 * Deploy smart contract program using fee wallet
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getFeeWalletKeypair } from '../src/config/wallet';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const PROGRAM_ID = new PublicKey('ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');

async function deployProgram() {
  try {
    console.log('🚀 Deploying smart contract program...\n');
    
    const feeWalletKeypair = getFeeWalletKeypair();
    const feeWalletAddress = feeWalletKeypair.publicKey.toString();
    
    console.log('💰 Using fee wallet:', feeWalletAddress);
    
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const balance = await connection.getBalance(feeWalletKeypair.publicKey);
    console.log(`💰 Fee wallet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
    
    if (balance < 2 * LAMPORTS_PER_SOL) {
      console.error('❌ Insufficient balance. Need at least 2 SOL for deployment.');
      return;
    }
    
    // Check if program exists
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (programInfo) {
      console.log('✅ Program already deployed at:', PROGRAM_ID.toString());
      console.log('   This will be an upgrade deployment.\n');
    } else {
      console.log('📦 Deploying new program to:', PROGRAM_ID.toString(), '\n');
    }
    
    // Build the program first
    console.log('🔨 Building program...');
    const { execSync } = require('child_process');
    const programDir = path.join(__dirname, '../programs/game-escrow');
    
    try {
      execSync('anchor build', { 
        cwd: programDir,
        stdio: 'inherit',
        env: { ...process.env, ANCHOR_WALLET: '~/.config/solana/devnet.json' }
      });
      console.log('✅ Build successful\n');
    } catch (buildError) {
      console.error('❌ Build failed:', buildError);
      return;
    }
    
    // Find the .so file
    const soFile = path.join(programDir, 'target/deploy/game_escrow.so');
    if (!fs.existsSync(soFile)) {
      console.error('❌ Compiled program not found at:', soFile);
      return;
    }
    
    console.log('📤 Deploying program...');
    console.log('   This may take a few minutes...\n');
    
    // Read the .so file
    const programBuffer = fs.readFileSync(soFile);
    
    // Deploy using fee wallet
    const deployTx = await connection.requestAirdrop(feeWalletKeypair.publicKey, 0);
    await connection.confirmTransaction(deployTx);
    
    // Use solana program deploy
    const deployCommand = `solana program deploy ${soFile} --program-id ${PROGRAM_ID.toString()} --keypair <(echo '${JSON.stringify(Array.from(feeWalletKeypair.secretKey))}') --url devnet`;
    
    console.log('⚠️ Manual deployment required:');
    console.log('   1. Build: cd backend/programs/game-escrow && anchor build');
    console.log('   2. Deploy: solana program deploy target/deploy/game_escrow.so \\');
    console.log(`      --program-id ${PROGRAM_ID.toString()} \\`);
    console.log(`      --keypair <path-to-fee-wallet-keypair> \\`);
    console.log('      --url devnet');
    console.log('\n   Or use Anchor CLI:');
    console.log('   anchor deploy --provider.cluster devnet --provider.wallet <fee-wallet-keypair-path>');
    
  } catch (error) {
    console.error('❌ Deployment error:', error);
  }
}

deployProgram()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });


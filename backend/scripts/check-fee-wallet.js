/**
 * Diagnostic script to check fee wallet configuration and balance
 * Run with: node backend/scripts/check-fee-wallet.js
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getFeeWalletKeypair, getFeeWalletAddress, FEE_WALLET_ADDRESS } = require('../src/config/wallet');

async function checkFeeWallet() {
  console.log('🔍 Fee Wallet Diagnostic Check\n');
  
  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log('  FEE_WALLET_ADDRESS:', process.env.FEE_WALLET_ADDRESS ? '✅ Set' : '❌ Not set');
  console.log('  FEE_WALLET_PRIVATE_KEY:', process.env.FEE_WALLET_PRIVATE_KEY ? `✅ Set (${process.env.FEE_WALLET_PRIVATE_KEY.length} chars)` : '❌ Not set');
  console.log('  SOLANA_NETWORK:', process.env.SOLANA_NETWORK || 'Not set (using default)');
  console.log('  SQUADS_NETWORK:', process.env.SQUADS_NETWORK || 'Not set (using default)');
  console.log('');
  
  // Check fee wallet address
  console.log('💰 Fee Wallet Address:');
  const feeWalletAddress = getFeeWalletAddress();
  console.log('  Address:', feeWalletAddress);
  console.log('  From config:', FEE_WALLET_ADDRESS);
  console.log('');
  
  // Try to load keypair
  console.log('🔑 Keypair Loading:');
  let keypair;
  try {
    keypair = getFeeWalletKeypair();
    console.log('  ✅ Keypair loaded successfully');
    console.log('  Public Key:', keypair.publicKey.toString());
    console.log('  Has Secret Key:', keypair.secretKey && keypair.secretKey.length > 0 ? '✅ Yes' : '❌ No');
    console.log('  Secret Key Length:', keypair.secretKey?.length || 0);
    
    // Verify public key matches address
    if (keypair.publicKey.toString() !== feeWalletAddress) {
      console.log('  ⚠️  WARNING: Public key does not match FEE_WALLET_ADDRESS!');
      console.log('     Public Key:', keypair.publicKey.toString());
      console.log('     Config Address:', feeWalletAddress);
    } else {
      console.log('  ✅ Public key matches FEE_WALLET_ADDRESS');
    }
  } catch (error) {
    console.log('  ❌ Failed to load keypair:', error.message);
    console.log('     Error:', error);
    process.exit(1);
  }
  console.log('');
  
  // Check on-chain balance
  console.log('🌐 On-Chain Balance Check:');
  const network = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  console.log('  Network:', network);
  
  try {
    const connection = new Connection(network, 'confirmed');
    const publicKey = new PublicKey(keypair.publicKey.toString());
    const balance = await connection.getBalance(publicKey);
    const balanceSOL = balance / 1e9;
    
    console.log('  ✅ Balance check successful');
    console.log('  Balance (lamports):', balance);
    console.log('  Balance (SOL):', balanceSOL.toFixed(9));
    console.log('  Sufficient for fees:', balance >= 0.001 * 1e9 ? '✅ Yes' : '❌ No (needs at least 0.001 SOL)');
    
    if (balance < 0.001 * 1e9) {
      console.log('  ⚠️  WARNING: Fee wallet has low balance!');
      console.log('     Current:', balanceSOL.toFixed(9), 'SOL');
      console.log('     Recommended minimum: 0.001 SOL');
    }
  } catch (error) {
    console.log('  ❌ Failed to check balance:', error.message);
    console.log('     Error:', error);
  }
  console.log('');
  
  console.log('✅ Diagnostic check complete');
}

checkFeeWallet().catch(error => {
  console.error('❌ Diagnostic check failed:', error);
  process.exit(1);
});


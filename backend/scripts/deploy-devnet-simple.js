#!/usr/bin/env node

/**
 * Simplified Devnet Deployment Script
 * This script sets up the environment for deployment without building
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function checkPrerequisites() {
  log('Checking prerequisites...');
  
  try {
    execSync('solana --version', { stdio: 'pipe' });
    log('Solana CLI found', 'success');
  } catch (error) {
    log('Solana CLI not found. Please install it first.', 'error');
    process.exit(1);
  }
  
  try {
    execSync('anchor --version', { stdio: 'pipe' });
    log('Anchor CLI found', 'success');
  } catch (error) {
    log('Anchor CLI not found. Please install it first.', 'error');
    process.exit(1);
  }
}

function setupDevnet() {
  log('Setting up devnet configuration...');
  
  try {
    // Set devnet RPC
    execSync('solana config set --url https://api.devnet.solana.com', { stdio: 'pipe' });
    log('Devnet RPC configured', 'success');
    
    // Check if wallet exists
    try {
      execSync('solana config get', { stdio: 'pipe' });
      log('Wallet configuration found', 'success');
    } catch (error) {
      log('No wallet found. Creating new wallet...', 'warning');
      execSync('solana-keygen new --outfile ~/.config/solana/id.json', { stdio: 'pipe' });
      log('New wallet created', 'success');
    }
    
    // Check if we need devnet SOL
    const currentBalance = execSync('solana balance', { stdio: 'pipe', encoding: 'utf8' });
    const balanceNum = parseFloat(currentBalance.trim().split(' ')[0]);
    
    if (balanceNum < 1) {
      log('Requesting devnet SOL...');
      execSync('solana airdrop 2', { stdio: 'pipe' });
      log('Devnet SOL received', 'success');
    } else {
      log(`Sufficient balance found: ${currentBalance.trim()}`, 'success');
    }
    
    // Check balance
    const finalBalance = execSync('solana balance', { stdio: 'pipe', encoding: 'utf8' });
    log(`Current balance: ${finalBalance.trim()}`, 'info');
    
  } catch (error) {
    log(`Failed to setup devnet: ${error.message}`, 'error');
    process.exit(1);
  }
}

function generateResultsAttestor() {
  log('Generating results attestor keypair...');
  
  try {
    const output = execSync('solana-keygen new --outfile ~/.config/solana/results-attestor.json', { 
      stdio: 'pipe', 
      encoding: 'utf8' 
    });
    
    // Extract public key
    const pubkeyMatch = output.match(/pubkey: (\w+)/);
    if (pubkeyMatch) {
      const pubkey = pubkeyMatch[1];
      log(`Results attestor generated: ${pubkey}`, 'success');
      return pubkey;
    } else {
      log('Failed to extract public key from keygen output', 'error');
      process.exit(1);
    }
  } catch (error) {
    log(`Failed to generate results attestor: ${error.message}`, 'error');
    process.exit(1);
  }
}

function generateEnvironmentConfig(resultsAttestorPubkey) {
  log('Generating environment configuration...');
  
  const envConfig = `
# Smart Contract Configuration for Devnet
# NOTE: You need to manually build and deploy the smart contract first
# Then replace this placeholder with your actual Program ID
SMART_CONTRACT_PROGRAM_ID=YOUR_PROGRAM_ID_HERE
RESULTS_ATTESTOR_PUBKEY=${resultsAttestorPubkey}
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000

# Solana Network Configuration
SOLANA_NETWORK=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet
`;

  // Write to file
  fs.writeFileSync('../smart-contract/.env.devnet', envConfig);
  log('Environment configuration written to ../smart-contract/.env.devnet', 'success');
  
  return envConfig;
}

function showDeploymentSummary(resultsAttestorPubkey, envConfig) {
  log('Devnet setup completed successfully!', 'success');
  log('');
  log('=== DEPLOYMENT SUMMARY ===');
  log(`Results Attestor: ${resultsAttestorPubkey}`);
  log(`Network: Devnet`);
  log(`RPC Endpoint: https://api.devnet.solana.com`);
  log('');
  
  log('=== NEXT STEPS ===');
  log('1. Build the smart contract manually:');
  log('   cd ../smart-contract');
  log('   anchor build');
  log('');
  log('2. Deploy the smart contract:');
  log('   anchor deploy --provider.cluster devnet');
  log('');
  log('3. Note the Program ID from the deployment output');
  log('');
  log('4. Update the .env.devnet file with your Program ID');
  log('');
  log('5. Add these environment variables to your Render backend:');
  console.log(envConfig);
  log('');
  log('6. Add these environment variables to your Vercel frontend:');
  log(`NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=YOUR_PROGRAM_ID_HERE`);
  log(`NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com`);
  log('');
  log('7. Run database migration: npm run migration:run');
  log('8. Test the integration with small amounts (0.001 SOL)');
  log('9. Monitor the system for 24-48 hours');
  log('');
  
  log('=== IMPORTANT SECURITY NOTES ===');
  log('⚠️  Store the results attestor private key securely!');
  log('   Location: ~/.config/solana/results-attestor.json');
  log('   This key is required to settle matches.');
  log('');
  log('⚠️  Test thoroughly with small amounts before mainnet deployment!');
  log('');
  
  log('=== TROUBLESHOOTING BUILD ISSUES ===');
  log('If you encounter build issues:');
  log('1. Make sure Rust is installed: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh');
  log('2. Install Solana toolchain: sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"');
  log('3. Install Anchor: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force');
  log('4. Use Anchor version manager: avm install latest && avm use latest');
  log('');
  
  log('=== MONITORING ===');
  log('Once deployed, monitor your contract on Solana Explorer:');
  log(`https://explorer.solana.com/?cluster=devnet`);
  log('');
  log('Key metrics to monitor:');
  log('- Match creation success rate');
  log('- Deposit success rate');
  log('- Settlement success rate');
  log('- Error rates and types');
}

function main() {
  log('Starting Guess5 Smart Contract Devnet Setup...');
  log('');
  
  try {
    checkPrerequisites();
    setupDevnet();
    const resultsAttestorPubkey = generateResultsAttestor();
    const envConfig = generateEnvironmentConfig(resultsAttestorPubkey);
    showDeploymentSummary(resultsAttestorPubkey, envConfig);
    
  } catch (error) {
    log(`Setup failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Run the setup
if (require.main === module) {
  main();
}

module.exports = {
  checkPrerequisites,
  setupDevnet,
  generateResultsAttestor,
  generateEnvironmentConfig
};



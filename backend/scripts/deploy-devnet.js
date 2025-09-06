#!/usr/bin/env node

/**
 * Simplified Devnet Deployment Script
 * Run this after installing Solana CLI and Anchor
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
    log('See: backend/scripts/setup-devnet-deployment.md', 'error');
    process.exit(1);
  }
  
  try {
    execSync('anchor --version', { stdio: 'pipe' });
    log('Anchor CLI found', 'success');
  } catch (error) {
    log('Anchor CLI not found. Please install it first.', 'error');
    log('See: backend/scripts/setup-devnet-deployment.md', 'error');
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

function buildContract() {
  log('Building smart contract...');
  
  try {
    execSync('cd ../smart-contract && anchor build', { stdio: 'inherit' });
    log('Smart contract built successfully', 'success');
  } catch (error) {
    log('Failed to build smart contract', 'error');
    process.exit(1);
  }
}

function deployContract() {
  log('Deploying smart contract to devnet...');
  
  try {
    const output = execSync('cd ../smart-contract && anchor deploy --provider.cluster devnet', { 
      stdio: 'pipe', 
      encoding: 'utf8' 
    });
    
    // Extract program ID
    const programIdMatch = output.match(/Program Id: (\w+)/);
    if (programIdMatch) {
      const programId = programIdMatch[1];
      log(`Smart contract deployed with Program ID: ${programId}`, 'success');
      return programId;
    } else {
      log('Failed to extract program ID from deployment output', 'error');
      process.exit(1);
    }
  } catch (error) {
    log(`Failed to deploy smart contract: ${error.message}`, 'error');
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

function runTests(programId) {
  log('Running smart contract tests...');
  
  try {
    // Update the program ID in Anchor.toml for testing
    const anchorTomlPath = '../smart-contract/Anchor.toml';
    let anchorToml = fs.readFileSync(anchorTomlPath, 'utf8');
    
    // Replace the program ID
    anchorToml = anchorToml.replace(
      /guess5_escrow = ".*"/,
      `guess5_escrow = "${programId}"`
    );
    
    fs.writeFileSync(anchorTomlPath, anchorToml);
    
    // Run tests
    execSync('cd ../smart-contract && anchor test', { stdio: 'inherit' });
    log('Smart contract tests passed', 'success');
  } catch (error) {
    log('Smart contract tests failed', 'error');
    log('Please check the test output above', 'error');
    process.exit(1);
  }
}

function generateEnvironmentConfig(programId, resultsAttestorPubkey) {
  log('Generating environment configuration...');
  
  const envConfig = `
# Smart Contract Configuration for Devnet
SMART_CONTRACT_PROGRAM_ID=${programId}
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
  fs.writeFileSync('smart-contract/.env.devnet', envConfig);
  log('Environment configuration written to smart-contract/.env.devnet', 'success');
  
  return envConfig;
}

function showDeploymentSummary(programId, resultsAttestorPubkey, envConfig) {
  log('Devnet deployment completed successfully!', 'success');
  log('');
  log('=== DEPLOYMENT SUMMARY ===');
  log(`Program ID: ${programId}`);
  log(`Results Attestor: ${resultsAttestorPubkey}`);
  log(`Network: Devnet`);
  log(`RPC Endpoint: https://api.devnet.solana.com`);
  log('');
  
  log('=== NEXT STEPS ===');
  log('1. Add these environment variables to your Render backend:');
  console.log(envConfig);
  log('');
  log('2. Add these environment variables to your Vercel frontend:');
  log(`NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=${programId}`);
  log(`NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com`);
  log('');
  log('3. Run database migration: npm run migration:run');
  log('4. Test the integration with small amounts (0.001 SOL)');
  log('5. Monitor the system for 24-48 hours');
  log('');
  
  log('=== IMPORTANT SECURITY NOTES ===');
  log('⚠️  Store the results attestor private key securely!');
  log('   Location: ~/.config/solana/results-attestor.json');
  log('   This key is required to settle matches.');
  log('');
  log('⚠️  Test thoroughly with small amounts before mainnet deployment!');
  log('');
  
  log('=== MONITORING ===');
  log('Monitor your contract on Solana Explorer:');
  log(`https://explorer.solana.com/address/${programId}?cluster=devnet`);
  log('');
  log('Key metrics to monitor:');
  log('- Match creation success rate');
  log('- Deposit success rate');
  log('- Settlement success rate');
  log('- Error rates and types');
}

function main() {
  log('Starting Guess5 Smart Contract Devnet Deployment...');
  log('');
  
  try {
    checkPrerequisites();
    setupDevnet();
    buildContract();
    const programId = deployContract();
    const resultsAttestorPubkey = generateResultsAttestor();
    runTests(programId);
    const envConfig = generateEnvironmentConfig(programId, resultsAttestorPubkey);
    showDeploymentSummary(programId, resultsAttestorPubkey, envConfig);
    
  } catch (error) {
    log(`Deployment failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Run the deployment
if (require.main === module) {
  main();
}

module.exports = {
  checkPrerequisites,
  setupDevnet,
  buildContract,
  deployContract,
  generateResultsAttestor,
  runTests,
  generateEnvironmentConfig
};

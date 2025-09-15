#!/usr/bin/env node

/**
 * Production Deployment Script for Guess5 Non-Custodial System
 * 
 * This script deploys the smart contract and configures the production environment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Production configuration based on your environment
const PRODUCTION_CONFIG = {
  // Your existing production setup
  feeWallet: '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
  feeWalletPrivateKey: '27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe',
  
  // Smart contract configuration
  defaultFeeBps: 500, // 5%
  deadlineBufferSlots: 1000,
  minStakeLamports: 1000000, // 0.001 SOL
  maxFeeBps: 1000, // 10%
  
  // Network configuration
  devnetRpc: 'https://api.devnet.solana.com',
  mainnetRpc: 'https://api.mainnet-beta.solana.com',
  
  // Deployment targets
  deployToDevnet: true, // Set to false for mainnet deployment
  deployToMainnet: false, // Set to true for mainnet deployment
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function checkPrerequisites() {
  log('Checking prerequisites...');
  
  // Check if Anchor is installed
  try {
    execSync('anchor --version', { stdio: 'pipe' });
    log('Anchor CLI found', 'success');
  } catch (error) {
    log('Anchor CLI not found. Please install it first: https://www.anchor-lang.com/docs/installation', 'error');
    process.exit(1);
  }
  
  // Check if Solana CLI is installed
  try {
    execSync('solana --version', { stdio: 'pipe' });
    log('Solana CLI found', 'success');
  } catch (error) {
    log('Solana CLI not found. Please install it first: https://docs.solana.com/cli/install-solana-cli-tools', 'error');
    process.exit(1);
  }
  
  // Check if we're in the right directory
  if (!fs.existsSync('smart-contract/Anchor.toml')) {
    log('Please run this script from the backend directory', 'error');
    process.exit(1);
  }
}

function checkSolanaConfig() {
  log('Checking Solana configuration...');
  
  try {
    const config = execSync('solana config get', { stdio: 'pipe', encoding: 'utf8' });
    log('Current Solana config:', 'info');
    console.log(config);
    
    // Check if we have a wallet configured
    const walletMatch = config.match(/Wallet Path: (.+)/);
    if (!walletMatch) {
      log('No wallet configured. Please run: solana config set --keypair ~/.config/solana/id.json', 'warning');
    }
    
  } catch (error) {
    log('Failed to get Solana config', 'error');
    process.exit(1);
  }
}

function buildContract() {
  log('Building smart contract...');
  
  try {
    execSync('cd smart-contract && anchor build', { stdio: 'inherit' });
    log('Smart contract built successfully', 'success');
  } catch (error) {
    log('Failed to build smart contract', 'error');
    process.exit(1);
  }
}

function deployToDevnet() {
  log('Deploying smart contract to devnet...');
  
  try {
    // Set devnet RPC
    execSync(`solana config set --url ${PRODUCTION_CONFIG.devnetRpc}`, { stdio: 'pipe' });
    
    // Deploy to devnet
    const deployCommand = 'cd smart-contract && anchor deploy --provider.cluster devnet';
    const output = execSync(deployCommand, { stdio: 'pipe', encoding: 'utf8' });
    
    // Extract program ID from output
    const programIdMatch = output.match(/Program Id: (\w+)/);
    if (programIdMatch) {
      const programId = programIdMatch[1];
      log(`Smart contract deployed to devnet with Program ID: ${programId}`, 'success');
      return programId;
    } else {
      log('Failed to extract program ID from deployment output', 'error');
      process.exit(1);
    }
  } catch (error) {
    log('Failed to deploy smart contract to devnet', 'error');
    log(error.message, 'error');
    process.exit(1);
  }
}

function deployToMainnet() {
  log('Deploying smart contract to mainnet...');
  
  try {
    // Set mainnet RPC
    execSync(`solana config set --url ${PRODUCTION_CONFIG.mainnetRpc}`, { stdio: 'pipe' });
    
    // Deploy to mainnet
    const deployCommand = 'cd smart-contract && anchor deploy --provider.cluster mainnet-beta';
    const output = execSync(deployCommand, { stdio: 'pipe', encoding: 'utf8' });
    
    // Extract program ID from output
    const programIdMatch = output.match(/Program Id: (\w+)/);
    if (programIdMatch) {
      const programId = programIdMatch[1];
      log(`Smart contract deployed to mainnet with Program ID: ${programId}`, 'success');
      return programId;
    } else {
      log('Failed to extract program ID from deployment output', 'error');
      process.exit(1);
    }
  } catch (error) {
    log('Failed to deploy smart contract to mainnet', 'error');
    log(error.message, 'error');
    process.exit(1);
  }
}

function generateResultsAttestor() {
  log('Generating results attestor keypair...');
  
  try {
    const output = execSync('solana-keygen new --no-bip39-passphrase --silent', { 
      stdio: 'pipe', 
      encoding: 'utf8' 
    });
    
    // Extract public key from output
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
    log('Failed to generate results attestor', 'error');
    process.exit(1);
  }
}

function runTests(programId) {
  log('Running smart contract tests...');
  
  try {
    // Update the program ID in Anchor.toml for testing
    const anchorTomlPath = 'smart-contract/Anchor.toml';
    let anchorToml = fs.readFileSync(anchorTomlPath, 'utf8');
    
    // Replace the program ID
    anchorToml = anchorToml.replace(
      /guess5_escrow = ".*"/,
      `guess5_escrow = "${programId}"`
    );
    
    fs.writeFileSync(anchorTomlPath, anchorToml);
    
    // Run tests
    execSync('cd smart-contract && anchor test', { stdio: 'inherit' });
    log('Smart contract tests passed', 'success');
  } catch (error) {
    log('Smart contract tests failed', 'error');
    log('Please fix the tests before proceeding', 'error');
    process.exit(1);
  }
}

function generateEnvironmentConfig(programId, resultsAttestorPubkey) {
  log('Generating environment configuration...');
  
  const envConfig = `
# Smart Contract Configuration for Production
SMART_CONTRACT_PROGRAM_ID=${programId}
RESULTS_ATTESTOR_PUBKEY=${resultsAttestorPubkey}
DEFAULT_FEE_BPS=${PRODUCTION_CONFIG.defaultFeeBps}
DEFAULT_DEADLINE_BUFFER_SLOTS=${PRODUCTION_CONFIG.deadlineBufferSlots}
MIN_STAKE_LAMPORTS=${PRODUCTION_CONFIG.minStakeLamports}
MAX_FEE_BPS=${PRODUCTION_CONFIG.maxFeeBps}

# Solana Network Configuration
SOLANA_NETWORK=${PRODUCTION_CONFIG.deployToMainnet ? PRODUCTION_CONFIG.mainnetRpc : PRODUCTION_CONFIG.devnetRpc}
SOLANA_CLUSTER=${PRODUCTION_CONFIG.deployToMainnet ? 'mainnet-beta' : 'devnet'}
`;

  // Write to file
  fs.writeFileSync('smart-contract/.env.production', envConfig);
  log('Environment configuration written to smart-contract/.env.production', 'success');
  
  return envConfig;
}

function showDeploymentSummary(programId, resultsAttestorPubkey, envConfig) {
  log('Deployment completed successfully!', 'success');
  log('');
  log('=== DEPLOYMENT SUMMARY ===');
  log(`Program ID: ${programId}`);
  log(`Results Attestor: ${resultsAttestorPubkey}`);
  log(`Network: ${PRODUCTION_CONFIG.deployToMainnet ? 'Mainnet' : 'Devnet'}`);
  log(`RPC Endpoint: ${PRODUCTION_CONFIG.deployToMainnet ? PRODUCTION_CONFIG.mainnetRpc : PRODUCTION_CONFIG.devnetRpc}`);
  log('');
  
  log('=== NEXT STEPS ===');
  log('1. Add these environment variables to your Render backend:');
  console.log(envConfig);
  log('');
  log('2. Add these environment variables to your Vercel frontend:');
  log(`NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=${programId}`);
  log(`NEXT_PUBLIC_SOLANA_NETWORK=${PRODUCTION_CONFIG.deployToMainnet ? PRODUCTION_CONFIG.mainnetRpc : PRODUCTION_CONFIG.devnetRpc}`);
  log('');
  log('3. Run database migration: npm run migration:run');
  log('4. Test the integration with small amounts');
  log('5. Monitor the system for 24-48 hours');
  log('');
  
  log('=== SECURITY REMINDERS ===');
  log('⚠️  IMPORTANT: Store the results attestor private key securely!');
  log('   This key is required to settle matches.');
  log('   Consider using a multisig for production.');
  log('');
  log('⚠️  IMPORTANT: Test thoroughly with small amounts before full rollout!');
  log('');
  
  log('=== MONITORING ===');
  log('Monitor these metrics:');
  log('- Match creation success rate');
  log('- Deposit success rate');
  log('- Settlement success rate');
  log('- Error rates and types');
  log('- Smart contract balance');
}

function main() {
  log('Starting Guess5 Smart Contract Production Deployment...');
  log('');
  
  try {
    checkPrerequisites();
    checkSolanaConfig();
    buildContract();
    
    let programId;
    if (PRODUCTION_CONFIG.deployToDevnet) {
      programId = deployToDevnet();
    } else if (PRODUCTION_CONFIG.deployToMainnet) {
      programId = deployToMainnet();
    } else {
      log('No deployment target specified', 'error');
      process.exit(1);
    }
    
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
  PRODUCTION_CONFIG,
  checkPrerequisites,
  checkSolanaConfig,
  buildContract,
  deployToDevnet,
  deployToMainnet,
  generateResultsAttestor,
  runTests,
  generateEnvironmentConfig
};















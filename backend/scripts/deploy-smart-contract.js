#!/usr/bin/env node

/**
 * Smart Contract Deployment Script
 * 
 * This script helps deploy the Guess5 escrow smart contract
 * and configure the backend to use it.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  cluster: process.env.SOLANA_CLUSTER || 'devnet',
  programId: process.env.SMART_CONTRACT_PROGRAM_ID,
  resultsAttestor: process.env.RESULTS_ATTESTOR_PUBKEY,
  feeWallet: process.env.FEE_WALLET_ADDRESS,
  defaultFeeBps: process.env.DEFAULT_FEE_BPS || '500',
  deadlineBufferSlots: process.env.DEFAULT_DEADLINE_BUFFER_SLOTS || '1000'
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
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

function checkEnvironment() {
  log('Checking environment configuration...');
  
  const requiredVars = [
    'FEE_WALLET_ADDRESS',
    'FEE_WALLET_PRIVATE_KEY'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    log(`Missing required environment variables: ${missingVars.join(', ')}`, 'error');
    log('Please set these variables before running the deployment', 'error');
    process.exit(1);
  }
  
  log('Environment configuration valid', 'success');
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

function deployContract() {
  log(`Deploying smart contract to ${CONFIG.cluster}...`);
  
  try {
    const deployCommand = `cd smart-contract && anchor deploy --provider.cluster ${CONFIG.cluster}`;
    const output = execSync(deployCommand, { stdio: 'pipe', encoding: 'utf8' });
    
    // Extract program ID from output
    const programIdMatch = output.match(/Program Id: (\w+)/);
    if (programIdMatch) {
      CONFIG.programId = programIdMatch[1];
      log(`Smart contract deployed with Program ID: ${CONFIG.programId}`, 'success');
    } else {
      log('Failed to extract program ID from deployment output', 'error');
      process.exit(1);
    }
  } catch (error) {
    log('Failed to deploy smart contract', 'error');
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
      CONFIG.resultsAttestor = pubkeyMatch[1];
      log(`Results attestor generated: ${CONFIG.resultsAttestor}`, 'success');
    } else {
      log('Failed to extract public key from keygen output', 'error');
      process.exit(1);
    }
  } catch (error) {
    log('Failed to generate results attestor', 'error');
    process.exit(1);
  }
}

function updateEnvironmentFile() {
  log('Updating environment configuration...');
  
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  
  const newEnvVars = [
    `# Smart Contract Configuration`,
    `SMART_CONTRACT_PROGRAM_ID=${CONFIG.programId}`,
    `RESULTS_ATTESTOR_PUBKEY=${CONFIG.resultsAttestor}`,
    `DEFAULT_FEE_BPS=${CONFIG.defaultFeeBps}`,
    `DEFAULT_DEADLINE_BUFFER_SLOTS=${CONFIG.deadlineBufferSlots}`,
    `MIN_STAKE_LAMPORTS=1000000`,
    `MAX_FEE_BPS=1000`,
    ``
  ].join('\n');
  
  // Remove existing smart contract config
  const cleanedContent = envContent.replace(
    /# Smart Contract Configuration[\s\S]*?(?=\n[A-Z_]|$)/,
    ''
  );
  
  const updatedContent = cleanedContent + '\n' + newEnvVars;
  
  fs.writeFileSync(envPath, updatedContent);
  log('Environment file updated', 'success');
}

function runTests() {
  log('Running smart contract tests...');
  
  try {
    execSync('cd smart-contract && anchor test', { stdio: 'inherit' });
    log('Smart contract tests passed', 'success');
  } catch (error) {
    log('Smart contract tests failed', 'error');
    log('Please fix the tests before proceeding', 'error');
    process.exit(1);
  }
}

function showNextSteps() {
  log('Deployment completed successfully!', 'success');
  log('');
  log('Next steps:');
  log('1. Run database migration: npm run migration:run');
  log('2. Update your backend configuration to use the new smart contract');
  log('3. Test the integration with small amounts');
  log('4. Gradually migrate existing matches to the new system');
  log('');
  log('Important configuration:');
  log(`- Program ID: ${CONFIG.programId}`);
  log(`- Results Attestor: ${CONFIG.resultsAttestor}`);
  log(`- Fee Wallet: ${CONFIG.feeWallet}`);
  log('');
  log('⚠️  IMPORTANT: Store the results attestor private key securely!');
  log('   This key is required to settle matches.');
}

function main() {
  log('Starting Guess5 Smart Contract Deployment...');
  log('');
  
  try {
    checkPrerequisites();
    checkEnvironment();
    buildContract();
    deployContract();
    generateResultsAttestor();
    updateEnvironmentFile();
    runTests();
    showNextSteps();
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
  CONFIG,
  checkPrerequisites,
  checkEnvironment,
  buildContract,
  deployContract,
  generateResultsAttestor,
  updateEnvironmentFile,
  runTests
};











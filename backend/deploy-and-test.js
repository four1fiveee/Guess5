const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Deploying and Testing Smart Contract on Devnet...\n');

try {
  // Change to the smart contract directory
  const contractDir = path.join(__dirname, 'guess5-escrow');
  process.chdir(contractDir);
  
  console.log('1. Building smart contract...');
  execSync('anchor build', { stdio: 'inherit' });
  console.log('✅ Build completed\n');

  console.log('2. Deploying to devnet...');
  execSync('anchor deploy --provider.cluster devnet', { stdio: 'inherit' });
  console.log('✅ Deployment completed\n');

  console.log('3. Running tests...');
  execSync('anchor test --provider.cluster devnet', { stdio: 'inherit' });
  console.log('✅ Tests completed\n');

  console.log('🎉 Smart contract deployment and testing completed successfully!');

} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
}

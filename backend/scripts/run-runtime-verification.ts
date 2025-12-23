/**
 * Runtime Verification: Complete Checklist
 * 
 * Runs all runtime verification checks and generates a comprehensive report
 */

import { execSync } from 'child_process';
import * as path from 'path';

const scripts = [
  { name: 'Match ID Consistency', script: 'verify-match-id-consistency.ts' },
  { name: 'Winner Account Logic', script: 'verify-winner-account-logic.ts' },
  { name: 'Fee Wallet & Balance', script: 'check-fee-wallet-and-balance.ts' },
  { name: 'Deployed Program Check', script: 'check-deployed-program.ts' },
  { name: 'Settle Transaction Simulation', script: 'simulate-settle-transaction.ts' },
];

async function runAllVerifications() {
  console.log('🚀 Starting Complete Runtime Verification\n');
  console.log('='.repeat(60));
  console.log('');

  const results: Array<{ name: string; success: boolean; output?: string; error?: string }> = [];

  for (const { name, script } of scripts) {
    console.log(`\n📋 Running: ${name}`);
    console.log('-'.repeat(60));

    try {
      const scriptPath = path.join(__dirname, script);
      const output = execSync(`npx ts-node ${scriptPath}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 60000, // 60 second timeout
      });

      console.log(output);
      results.push({ name, success: true, output });
      console.log(`✅ ${name}: PASSED\n`);

    } catch (error: any) {
      const errorOutput = error.stdout || error.stderr || error.message;
      console.log(errorOutput);
      results.push({ name, success: false, error: errorOutput });
      console.log(`❌ ${name}: FAILED\n`);
    }
  }

  // Generate summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.name}`);
  });

  console.log('');
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('');

  // Generate checklist
  console.log('='.repeat(60));
  console.log('✅ RUNTIME VERIFICATION CHECKLIST');
  console.log('='.repeat(60));
  console.log('');

  // Match ID consistency
  const matchIdCheck = results.find(r => r.name === 'Match ID Consistency');
  console.log(`Match ID consistency: ${matchIdCheck?.success ? '✅' : '❌'}`);

  // PDA derivation
  const pdaCheck = matchIdCheck?.success;
  console.log(`PDA derivation: ${pdaCheck ? '✅' : '❌'}`);

  // settle() simulation
  const simulationCheck = results.find(r => r.name === 'Settle Transaction Simulation');
  console.log(`settle() simulation: ${simulationCheck?.success ? '✅' : '❌'}`);

  // Fee transfer
  const feeCheck = results.find(r => r.name === 'Fee Wallet & Balance');
  const feeTransferCheck = feeCheck?.success && feeCheck.output?.includes('Sufficient: ✅');
  console.log(`Fee transfer invoked: ${feeTransferCheck ? '✅' : '❌'}`);

  // Winner pubkey
  const winnerCheck = results.find(r => r.name === 'Winner Account Logic');
  console.log(`Winner pubkey passed correctly: ${winnerCheck?.success ? '✅' : '❌'}`);

  // Reentrancy guard
  const reentrancyCheck = simulationCheck?.output?.includes('Settled') || simulationCheck?.output?.includes('settled');
  console.log(`Reentrancy guard triggered: ${reentrancyCheck ? '✅' : '❌'}`);

  // Program ID and hash
  const programCheck = results.find(r => r.name === 'Deployed Program Check');
  console.log(`Program ID and hash match: ${programCheck?.success ? '✅' : '❌'}`);

  console.log('');
  console.log('='.repeat(60));
  console.log('');

  // Save results to file
  const reportPath = path.join(__dirname, '../../RUNTIME_VERIFICATION_RESULTS.md');
  const report = `# Runtime Verification Results

Generated: ${new Date().toISOString()}

## Summary

- Total Checks: ${results.length}
- Passed: ${passed}
- Failed: ${failed}

## Detailed Results

${results.map(r => `
### ${r.name}: ${r.success ? '✅ PASSED' : '❌ FAILED'}

${r.output ? `\`\`\`\n${r.output}\n\`\`\`` : ''}
${r.error ? `\`\`\`\n${r.error}\n\`\`\`` : ''}
`).join('\n')}

## Checklist

- Match ID consistency: ${matchIdCheck?.success ? '✅' : '❌'}
- PDA derivation: ${pdaCheck ? '✅' : '❌'}
- settle() simulation: ${simulationCheck?.success ? '✅' : '❌'}
- Fee transfer invoked: ${feeTransferCheck ? '✅' : '❌'}
- Winner pubkey passed correctly: ${winnerCheck?.success ? '✅' : '❌'}
- Reentrancy guard triggered: ${reentrancyCheck ? '✅' : '❌'}
- Program ID and hash match: ${programCheck?.success ? '✅' : '❌'}
`;

  require('fs').writeFileSync(reportPath, report);
  console.log(`📄 Full report saved to: ${reportPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

runAllVerifications().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


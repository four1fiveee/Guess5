/**
 * Calculate fee wallet costs per game for Squads multisig operations
 * Normalized to $20 USD entry fee threshold
 */

// Cost constants from code analysis
const COSTS = {
  // Vault creation costs (paid by fee wallet)
  VAULT_RENT_EXEMPTION: 0.00249864, // SOL - Fixed rent exemption for Squads vault account (doesn't scale with balance)
  VAULT_CREATION_TX_FEE: 0.000005, // SOL - Transaction fee for creating vault
  
  // Proposal creation costs (paid by fee wallet)
  PROPOSAL_CREATION_TX_FEE: 0.000005, // SOL - Transaction fee for creating proposal
  
  // Execution costs (paid by fee wallet)
  EXECUTION_TX_FEE: 0.000005, // SOL - Base transaction fee
  PRIORITY_FEE_BASE: 0.00002, // SOL - Base priority fee (20,000 microLamports)
  PRIORITY_FEE_MAX: 0.00005, // SOL - Max priority fee (2.5x multiplier)
  PRIORITY_FEE_AVG: 0.00003, // SOL - Average priority fee per attempt
  
  // Average execution attempts per match (based on retry logic)
  AVG_EXECUTION_ATTEMPTS: 3, // Average attempts before success or failure
};

// Normalization: $20 USD at $150/SOL = 0.1333 SOL
const NORMALIZED_ENTRY_FEE = 20 / 150; // 0.1333 SOL

interface FeeWalletCosts {
  perGame: {
    vaultCreation: number;
    proposalCreation: number;
    execution: number;
    total: number;
  };
  normalized: {
    vaultCreation: number;
    proposalCreation: number;
    execution: number;
    total: number;
  };
  breakdown: {
    rentExemption: number;
    transactionFees: number;
    priorityFees: number;
  };
}

function calculateFeeWalletCosts(): FeeWalletCosts {
  // Per game costs (regardless of entry fee amount)
  const vaultCreation = COSTS.VAULT_RENT_EXEMPTION + COSTS.VAULT_CREATION_TX_FEE;
  const proposalCreation = COSTS.PROPOSAL_CREATION_TX_FEE;
  const execution = COSTS.EXECUTION_TX_FEE + (COSTS.AVG_EXECUTION_ATTEMPTS * COSTS.PRIORITY_FEE_AVG);
  
  const totalPerGame = vaultCreation + proposalCreation + execution;
  
  // Costs are the same regardless of entry fee (rent exemption is fixed)
  // So normalized costs = per game costs
  const normalized = {
    vaultCreation,
    proposalCreation,
    execution,
    total: totalPerGame,
  };
  
  // Breakdown
  const breakdown = {
    rentExemption: COSTS.VAULT_RENT_EXEMPTION,
    transactionFees: COSTS.VAULT_CREATION_TX_FEE + COSTS.PROPOSAL_CREATION_TX_FEE + COSTS.EXECUTION_TX_FEE,
    priorityFees: COSTS.AVG_EXECUTION_ATTEMPTS * COSTS.PRIORITY_FEE_AVG,
  };
  
  return {
    perGame: {
      vaultCreation,
      proposalCreation,
      execution,
      total: totalPerGame,
    },
    normalized,
    breakdown,
  };
}

function main() {
  const costs = calculateFeeWalletCosts();
  const solPriceUSD = 150;
  
  console.log('\n💰 FEE WALLET COSTS PER GAME\n');
  console.log('═'.repeat(70));
  console.log(`Normalized Entry Fee: $20 USD (${NORMALIZED_ENTRY_FEE.toFixed(4)} SOL at $${solPriceUSD}/SOL)`);
  console.log('─'.repeat(70));
  console.log('\n📊 Cost Breakdown (Fixed - Does NOT scale with vault balance):\n');
  console.log(`  Vault Creation:`);
  console.log(`    - Rent Exemption:     ${costs.breakdown.rentExemption.toFixed(6)} SOL ($${(costs.breakdown.rentExemption * solPriceUSD).toFixed(4)})`);
  console.log(`    - Creation TX Fee:     ${COSTS.VAULT_CREATION_TX_FEE.toFixed(6)} SOL ($${(COSTS.VAULT_CREATION_TX_FEE * solPriceUSD).toFixed(4)})`);
  console.log(`    - Subtotal:            ${costs.perGame.vaultCreation.toFixed(6)} SOL ($${(costs.perGame.vaultCreation * solPriceUSD).toFixed(4)})`);
  console.log('');
  console.log(`  Proposal Creation:`);
  console.log(`    - TX Fee:              ${costs.perGame.proposalCreation.toFixed(6)} SOL ($${(costs.perGame.proposalCreation * solPriceUSD).toFixed(4)})`);
  console.log('');
  console.log(`  Execution (Average):`);
  console.log(`    - Base TX Fee:         ${COSTS.EXECUTION_TX_FEE.toFixed(6)} SOL ($${(COSTS.EXECUTION_TX_FEE * solPriceUSD).toFixed(4)})`);
  console.log(`    - Priority Fees:       ${costs.breakdown.priorityFees.toFixed(6)} SOL ($${(costs.breakdown.priorityFees * solPriceUSD).toFixed(4)})`);
  console.log(`      (${COSTS.AVG_EXECUTION_ATTEMPTS} attempts × ${COSTS.PRIORITY_FEE_AVG.toFixed(6)} SOL avg)`);
  console.log(`    - Subtotal:            ${costs.perGame.execution.toFixed(6)} SOL ($${(costs.perGame.execution * solPriceUSD).toFixed(4)})`);
  console.log('─'.repeat(70));
  console.log(`  TOTAL PER GAME:         ${costs.perGame.total.toFixed(6)} SOL ($${(costs.perGame.total * solPriceUSD).toFixed(4)})`);
  console.log('═'.repeat(70));
  
  console.log('\n📝 Key Points:');
  console.log('  ✅ Rent exemption is FIXED - does NOT scale with vault balance');
  console.log('  ✅ Transaction fees are FIXED - do NOT scale with transaction amount');
  console.log('  ✅ Priority fees are FIXED per attempt - do NOT scale with vault balance');
  console.log('  ✅ Costs are the same whether entry fee is $5 or $500');
  console.log('  ✅ Normalized to $20 USD entry fee, but costs are identical for any entry fee');
  
  console.log('\n💡 Cost Efficiency:');
  const costPercentage = (costs.perGame.total * solPriceUSD / 20) * 100;
  console.log(`  Fee wallet costs: ${costPercentage.toFixed(2)}% of $20 entry fee`);
  console.log(`  Platform fee (5%): $1.00 per $20 match`);
  console.log(`  Net profit per match: $${(20 - costs.perGame.total * solPriceUSD - 1).toFixed(2)}`);
  console.log('');
}

if (require.main === module) {
  main();
}

export { calculateFeeWalletCosts };






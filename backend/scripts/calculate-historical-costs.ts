/**
 * Calculate historical Squads fees and fee wallet costs from database
 * This script analyzes all matches with Squads vaults and estimates costs
 */

import { AppDataSource } from '../db';
import { Match } from '../models/Match';

// Cost constants based on code analysis
const COSTS = {
  // Vault creation: rent exemption + transaction fees (~0.1 SOL minimum)
  VAULT_CREATION: 0.1, // SOL per vault
  
  // Standard Solana transaction fees
  STANDARD_TX_FEE: 0.000005, // SOL per transaction
  
  // Priority fees for execution (from squadsVaultService.ts)
  PRIORITY_FEE_BASE: 0.00002, // Base priority fee (20,000 microLamports)
  PRIORITY_FEE_MAX: 0.00005, // Max priority fee (2.5x multiplier)
  PRIORITY_FEE_AVG: 0.00003, // Average priority fee (estimated)
  
  // Proposal creation transaction fee
  PROPOSAL_CREATION_FEE: 0.000005, // SOL per proposal creation
  
  // Estimated execution attempts per match (based on retry logic)
  AVG_EXECUTION_ATTEMPTS: 3, // Average attempts before success or failure
};

interface CostBreakdown {
  vaultCreation: number;
  depositTransactions: number;
  proposalCreation: number;
  executionAttempts: number;
  total: number;
  matchCount: number;
  avgPerMatch: number;
}

async function calculateHistoricalCosts(): Promise<CostBreakdown> {
  const matchRepository = AppDataSource.getRepository(Match);
  
  // Get all matches with Squads vaults
  const matches = await matchRepository.query(`
    SELECT 
      id,
      "squadsVaultAddress",
      "payoutProposalId",
      "tieRefundProposalId",
      "proposalStatus",
      "proposalTransactionId",
      "player1PaymentSignature",
      "player2PaymentSignature",
      "entryFee"
    FROM "match"
    WHERE "squadsVaultAddress" IS NOT NULL
  `);
  
  console.log(`\n📊 Analyzing ${matches.length} matches with Squads vaults...\n`);
  
  // Count unique vaults (each vault creation costs ~0.1 SOL)
  const uniqueVaults = new Set(matches.map((m: any) => m.squadsVaultAddress));
  const vaultCreationCost = uniqueVaults.size * COSTS.VAULT_CREATION;
  
  // Count deposit transactions (player payments to vault)
  const depositCount = matches.filter((m: any) => 
    m.player1PaymentSignature || m.player2PaymentSignature
  ).length * 2; // Each match has 2 deposits
  const depositTxCost = depositCount * COSTS.STANDARD_TX_FEE;
  
  // Count proposal creations
  const payoutProposals = matches.filter((m: any) => m.payoutProposalId).length;
  const tieRefundProposals = matches.filter((m: any) => m.tieRefundProposalId).length;
  const totalProposals = payoutProposals + tieRefundProposals;
  const proposalCreationCost = totalProposals * COSTS.PROPOSAL_CREATION_FEE;
  
  // Estimate execution attempts
  // Matches in READY_TO_EXECUTE or APPROVED status likely had multiple execution attempts
  const executionAttemptMatches = matches.filter((m: any) => 
    m.proposalStatus === 'READY_TO_EXECUTE' || 
    m.proposalStatus === 'APPROVED' ||
    m.proposalStatus === 'ACTIVE'
  ).length;
  
  // Also count executed proposals (they succeeded after attempts)
  const executedMatches = matches.filter((m: any) => 
    m.proposalStatus === 'EXECUTED'
  ).length;
  
  // Estimate execution attempts: each match likely had multiple attempts
  // Based on the retry logic (maxAttempts = 10, but average is lower)
  const totalExecutionAttempts = (executionAttemptMatches + executedMatches) * COSTS.AVG_EXECUTION_ATTEMPTS;
  const executionAttemptCost = totalExecutionAttempts * COSTS.PRIORITY_FEE_AVG;
  
  const total = vaultCreationCost + depositTxCost + proposalCreationCost + executionAttemptCost;
  const avgPerMatch = total / matches.length;
  
  const breakdown: CostBreakdown = {
    vaultCreation: vaultCreationCost,
    depositTransactions: depositTxCost,
    proposalCreation: proposalCreationCost,
    executionAttempts: executionAttemptCost,
    total,
    matchCount: matches.length,
    avgPerMatch,
  };
  
  return breakdown;
}

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connected');
    
    const costs = await calculateHistoricalCosts();
    
    console.log('\n💰 HISTORICAL COST BREAKDOWN\n');
    console.log('═'.repeat(60));
    console.log(`Total Matches Analyzed: ${costs.matchCount}`);
    console.log(`Unique Vaults Created: ${Math.round(costs.vaultCreation / COSTS.VAULT_CREATION)}`);
    console.log('─'.repeat(60));
    console.log('\n📊 Cost Breakdown:\n');
    console.log(`  Vault Creation:        ${costs.vaultCreation.toFixed(6)} SOL`);
    console.log(`  Deposit Transactions:  ${costs.depositTransactions.toFixed(6)} SOL`);
    console.log(`  Proposal Creation:     ${costs.proposalCreation.toFixed(6)} SOL`);
    console.log(`  Execution Attempts:    ${costs.executionAttempts.toFixed(6)} SOL`);
    console.log('─'.repeat(60));
    console.log(`  TOTAL COST:            ${costs.total.toFixed(6)} SOL`);
    console.log(`  Average per Match:     ${costs.avgPerMatch.toFixed(6)} SOL`);
    console.log('═'.repeat(60));
    
    // Convert to USD (assuming ~$150/SOL average)
    const solPriceUSD = 150;
    console.log(`\n💵 Estimated USD Value (at $${solPriceUSD}/SOL):`);
    console.log(`  Total Cost: $${(costs.total * solPriceUSD).toFixed(2)}`);
    console.log(`  Per Match:  $${(costs.avgPerMatch * solPriceUSD).toFixed(4)}`);
    
    console.log('\n📝 Notes:');
    console.log('  - Vault creation includes rent exemption (~0.1 SOL)');
    console.log('  - Execution attempts include priority fees (0.00002-0.00005 SOL each)');
    console.log('  - Actual costs may vary based on network conditions');
    console.log('  - This is an estimate based on code analysis and database data\n');
    
    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { calculateHistoricalCosts };






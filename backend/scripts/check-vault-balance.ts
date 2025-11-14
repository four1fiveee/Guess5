import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const VAULT_PDA = '9oEXMDVt9nbBCmK8enbqEYi9y6oMm6WDbQz4oJHYWhNp';
const PROPOSAL_PDA = 'ERzqBE6ka1hKeMb4WzTxTsRuetDhiqpEDpGjq2bRLZen';
const PLAYER1 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
const PLAYER2 = '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU';
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

async function checkVaultBalance() {
  const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Checking on-chain state...\n');
  
  // Check vault balance
  const vaultPda = new PublicKey(VAULT_PDA);
  const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
  console.log(`💰 Vault PDA (${VAULT_PDA}):`);
  console.log(`   Balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL (${vaultBalance} lamports)\n`);
  
  // Check player balances
  const player1Pubkey = new PublicKey(PLAYER1);
  const player2Pubkey = new PublicKey(PLAYER2);
  const feeWalletPubkey = new PublicKey(FEE_WALLET);
  
  const player1Balance = await connection.getBalance(player1Pubkey, 'confirmed');
  const player2Balance = await connection.getBalance(player2Pubkey, 'confirmed');
  const feeWalletBalance = await connection.getBalance(feeWalletPubkey, 'confirmed');
  
  console.log(`👤 Player 1 (${PLAYER1}):`);
  console.log(`   Balance: ${player1Balance / LAMPORTS_PER_SOL} SOL\n`);
  
  console.log(`👤 Player 2 (${PLAYER2}):`);
  console.log(`   Balance: ${player2Balance / LAMPORTS_PER_SOL} SOL\n`);
  
  console.log(`💼 Fee Wallet (${FEE_WALLET}):`);
  console.log(`   Balance: ${feeWalletBalance / LAMPORTS_PER_SOL} SOL\n`);
  
  // Check proposal status
  try {
    const { SquadsVaultService } = require('../src/services/squadsVaultService');
    const squadsService = new SquadsVaultService();
    const proposalStatus = await squadsService.checkProposalStatus(
      'DxqYzDYuiusjzTjyo8LzrVqPqfMN8vvsykvSFmxZ28Yy',
      '1'
    );
    
    console.log(`📋 Proposal Status:`);
    console.log(`   Executed: ${proposalStatus.executed}`);
    console.log(`   Signers: ${proposalStatus.signers.map((s: PublicKey) => s.toString()).join(', ')}`);
    console.log(`   Needs Signatures: ${proposalStatus.needsSignatures}\n`);
  } catch (error: any) {
    console.error(`❌ Error checking proposal status: ${error.message}\n`);
  }
  
  // Expected amounts (for tie refund: 95% to each player)
  const entryFee = 0.1299;
  const refundAmount = entryFee * 0.95;
  console.log(`📊 Expected Refund Amount: ${refundAmount} SOL per player (95% of ${entryFee} SOL entry fee)\n`);
  
  console.log('✅ On-chain state check complete');
}

checkVaultBalance().catch(console.error);





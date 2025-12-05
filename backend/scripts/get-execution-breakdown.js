const { Connection, PublicKey } = require('@solana/web3.js');

const VAULT_PDA = 'A2CCpQKxFheSvraJFL5PdFdaZE229K8GKrY7TUcS28Cj';
const WINNER_WALLET = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
const PROPOSAL_APPROVAL_TX = 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K';

async function getBreakdown() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Finding Execution Transaction and Fund Breakdown\n');
  console.log(`Vault PDA: ${VAULT_PDA}`);
  console.log(`Winner: ${WINNER_WALLET}`);
  console.log(`Fee Wallet: ${FEE_WALLET}\n`);

  try {
    // Get vault balance history
    const vaultPubkey = new PublicKey(VAULT_PDA);
    const signatures = await connection.getSignaturesForAddress(vaultPubkey, { limit: 50 });
    
    console.log(`Found ${signatures.length} transactions for vault\n`);
    
    // Find transactions after proposal approval (19:04:56 = 1733421896 timestamp)
    const approvalTime = 1733421896;
    let executionTx = null;
    
    for (const sig of signatures) {
      if (sig.signature === PROPOSAL_APPROVAL_TX) continue;
      
      if (sig.blockTime && sig.blockTime > approvalTime) {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });
        
        if (tx && tx.meta && !tx.meta.err) {
          const logs = tx.meta.logMessages || [];
          const hasExecute = logs.some(log => 
            log.includes('VaultTransactionExecute') ||
            log.includes('Execute') ||
            log.includes('execute')
          );
          
          if (hasExecute) {
            executionTx = { sig: sig.signature, tx, blockTime: sig.blockTime };
            console.log(`✅ Found execution transaction: ${sig.signature}`);
            console.log(`   Block Time: ${new Date(sig.blockTime * 1000).toISOString()}\n`);
            break;
          }
        }
      }
    }
    
    if (!executionTx) {
      console.log('⚠️  Execution transaction not found. Analyzing vault balance changes...\n');
      
      // Get current vault balance
      const vaultBalance = await connection.getBalance(vaultPubkey);
      console.log(`Current Vault Balance: ${(vaultBalance / 1e9).toFixed(9)} SOL`);
      console.log(`Expected Balance After Execution: ~0 SOL (if executed)\n`);
      
      // The vault had 0.0764 SOL before execution
      // If it's now 0 or very low, execution likely happened
      if (vaultBalance < 1000000) { // Less than 0.001 SOL
        console.log('✅ Vault balance is near zero - execution likely completed');
        console.log(`\n💰 Estimated Fund Breakdown:\n`);
        console.log(`Total in Vault (before execution): 0.0764 SOL`);
        console.log(`Winner should receive: ~0.0382 SOL (50% of 0.0764)`);
        console.log(`Fee wallet should receive: ~0.0382 SOL (50% of 0.0764)`);
        console.log(`Transaction fees: ~0.000005 SOL (typical Solana fee)`);
      }
      
      return;
    }
    
    // Analyze the execution transaction
    const { tx } = executionTx;
    const preBalances = tx.meta.preBalances || [];
    const postBalances = tx.meta.postBalances || [];
    const accountKeys = tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys || [];
    
    console.log('📊 Execution Transaction Breakdown:\n');
    
    const balanceChanges = [];
    const numAccounts = Math.min(accountKeys.length, preBalances.length, postBalances.length);
    
    for (let i = 0; i < numAccounts; i++) {
      const account = accountKeys[i];
      const pubkey = account.pubkey ? account.pubkey.toString() : account.toString();
      const preBalance = (preBalances[i] || 0) / 1e9;
      const postBalance = (postBalances[i] || 0) / 1e9;
      const change = postBalance - preBalance;
      
      if (Math.abs(change) > 0.000001) {
        balanceChanges.push({ pubkey, preBalance, postBalance, change });
      }
    }
    
    // Find key accounts
    const vaultChange = balanceChanges.find(b => b.pubkey === VAULT_PDA);
    const winnerChange = balanceChanges.find(b => b.pubkey === WINNER_WALLET);
    const feeChange = balanceChanges.find(b => b.pubkey === FEE_WALLET);
    
    console.log('💰 Fund Breakdown:\n');
    
    if (vaultChange) {
      console.log(`Vault (${VAULT_PDA.slice(0, 20)}...): ${vaultChange.change.toFixed(9)} SOL`);
    }
    
    if (winnerChange) {
      console.log(`✅ Winner (${WINNER_WALLET.slice(0, 20)}...): +${winnerChange.change.toFixed(9)} SOL`);
    } else {
      console.log(`⚠️  Winner: No balance change detected`);
    }
    
    if (feeChange) {
      console.log(`✅ Fee Wallet (${FEE_WALLET.slice(0, 20)}...): +${feeChange.change.toFixed(9)} SOL`);
    } else {
      console.log(`⚠️  Fee Wallet: No balance change detected`);
    }
    
    const totalSent = balanceChanges.filter(b => b.change < 0).reduce((sum, b) => sum + Math.abs(b.change), 0);
    const totalReceived = balanceChanges.filter(b => b.change > 0).reduce((sum, b) => sum + b.change, 0);
    const fees = totalSent - totalReceived;
    
    console.log(`\n📈 Totals:`);
    console.log(`   Total Sent: ${totalSent.toFixed(9)} SOL`);
    console.log(`   Total Received: ${totalReceived.toFixed(9)} SOL`);
    console.log(`   Fees/Costs: ${fees.toFixed(9)} SOL`);
    
    console.log(`\n🔗 Transaction: https://explorer.solana.com/tx/${executionTx.sig}?cluster=devnet`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

getBreakdown().catch(console.error);


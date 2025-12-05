const { Connection, PublicKey } = require('@solana/web3.js');

const VAULT_PDA = 'A2CCpQKxFheSvraJFL5PdFdaZE229K8GKrY7TUcS28Cj';
const MULTISIG_ADDRESS = 'EWr3oLy9ZSCMMSuukYiQdTsRrr9eW8bzsDvZgWn5Ba6s';
const PROPOSAL_PDA = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';

async function checkVaultTransactions() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Checking Vault Transactions\n');
  console.log(`Vault PDA: ${VAULT_PDA}`);
  console.log(`Multisig: ${MULTISIG_ADDRESS}`);
  console.log(`Proposal PDA: ${PROPOSAL_PDA}\n`);

  try {
    // Check transactions for vault PDA
    console.log('📋 Checking Vault PDA transactions...\n');
    const vaultPubkey = new PublicKey(VAULT_PDA);
    const vaultSigs = await connection.getSignaturesForAddress(vaultPubkey, { limit: 20 });
    
    console.log(`Found ${vaultSigs.length} transactions for vault PDA\n`);
    
    for (const sig of vaultSigs) {
      if (sig.signature === 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K') {
        continue;
      }
      
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });
      
      if (tx && tx.meta && !tx.meta.err) {
        const logs = tx.meta.logMessages || [];
        const hasExecute = logs.some(log => 
          log.includes('Execute') ||
          log.includes('VaultTransaction') ||
          log.includes('Transfer')
        );
        
        if (hasExecute) {
          console.log(`\n🎯 Potential Execution Transaction: ${sig.signature}`);
          console.log(`   Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
          console.log(`   Slot: ${sig.slot}`);
          
          // Show balance changes
          if (tx.meta.preBalances && tx.meta.postBalances) {
            console.log(`   Balance Changes:`);
            for (let i = 0; i < Math.min(tx.transaction.message.accountKeys.length, tx.meta.preBalances.length); i++) {
              const pre = tx.meta.preBalances[i] / 1e9;
              const post = tx.meta.postBalances[i] / 1e9;
              const change = post - pre;
              if (Math.abs(change) > 0.000001) {
                const account = tx.transaction.message.accountKeys[i];
                const pubkey = account.pubkey ? account.pubkey.toString() : account.toString();
                console.log(`     ${pubkey.slice(0, 20)}...: ${change > 0 ? '+' : ''}${change.toFixed(9)} SOL`);
              }
            }
          }
          
          console.log('');
        }
      }
    }
    
    // Check multisig transactions
    console.log('\n📋 Checking Multisig transactions...\n');
    const multisigPubkey = new PublicKey(MULTISIG_ADDRESS);
    const multisigSigs = await connection.getSignaturesForAddress(multisigPubkey, { limit: 20 });
    
    console.log(`Found ${multisigSigs.length} transactions for multisig\n`);
    
    for (const sig of multisigSigs) {
      if (sig.signature === 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K') {
        continue;
      }
      
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });
      
      if (tx && tx.meta && !tx.meta.err) {
        const logs = tx.meta.logMessages || [];
        const hasExecute = logs.some(log => 
          log.includes('Execute') ||
          log.includes('VaultTransaction') ||
          log.includes('Transfer')
        );
        
        if (hasExecute) {
          console.log(`\n🎯 Potential Execution Transaction: ${sig.signature}`);
          console.log(`   Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
          console.log(`   Slot: ${sig.slot}\n`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

checkVaultTransactions().catch(console.error);


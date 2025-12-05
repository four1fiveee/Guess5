const { Connection, PublicKey } = require('@solana/web3.js');
const { Multisig } = require('@sqds/multisig');

const PROPOSAL_PDA = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';
const VAULT_PDA = '7VqFqJqFqJqFqJqFqJqFqJqFqJqFqJqFqJqFqJqFqJq'; // We'll need to find this

async function findExecutionTransaction() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Finding Execution Transaction\n');
  console.log(`Proposal PDA: ${PROPOSAL_PDA}\n`);

  try {
    // Try to get the proposal account
    const proposalPubkey = new PublicKey(PROPOSAL_PDA);
    
    // Get recent transactions for the proposal account
    const signatures = await connection.getSignaturesForAddress(proposalPubkey, { limit: 10 });
    
    console.log('📋 Recent Transactions for Proposal PDA:\n');
    signatures.forEach((sig, i) => {
      console.log(`${i + 1}. ${sig.signature}`);
      console.log(`   Slot: ${sig.slot}`);
      console.log(`   Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
      console.log(`   Confirmation Status: ${sig.confirmationStatus || 'N/A'}`);
      console.log(`   Error: ${sig.err ? JSON.stringify(sig.err) : 'None'}\n`);
    });

    // Check each transaction to find the execution
    for (const sig of signatures) {
      if (sig.signature === 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K') {
        console.log('⏭️  Skipping proposal approval transaction...\n');
        continue;
      }

      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (tx && tx.meta && !tx.meta.err) {
        // Check if this is an execution transaction
        const logs = tx.meta.logMessages || [];
        const hasExecute = logs.some(log => 
          log.includes('Execute') || 
          log.includes('VaultTransaction') ||
          log.includes('ProposalExecute')
        );

        if (hasExecute) {
          console.log(`\n✅ Found Execution Transaction: ${sig.signature}\n`);
          return sig.signature;
        }
      }
    }

    console.log('\n⚠️  Could not find execution transaction in recent signatures');
    console.log('The execution may not have completed yet, or it may be in a different account.');

  } catch (error) {
    console.error('❌ Error finding execution transaction:', error);
  }
}

findExecutionTransaction().catch(console.error);


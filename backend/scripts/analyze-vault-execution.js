const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getVaultTransactionPda } = require('@sqds/multisig');

const PROPOSAL_PDA = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';
const MATCH_ID = 'e2af9ab0-8d8d-4039-bc3e-64ca6d6b6633';

async function analyzeVaultExecution() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Analyzing Vault Execution\n');
  console.log(`Proposal PDA: ${PROPOSAL_PDA}`);
  console.log(`Match ID: ${MATCH_ID}\n`);

  try {
    // Get the proposal account
    const proposalPubkey = new PublicKey(PROPOSAL_PDA);
    
    // Try to derive the vault transaction PDA from the proposal
    // In Squads v4, proposals reference vault transactions
    const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPubkey);
    
    console.log('📋 Proposal Account Data:\n');
    console.log(`Status: ${proposalAccount.status}`);
    console.log(`Vault Transaction Index: ${proposalAccount.vaultTransactionIndex}`);
    console.log(`Multisig: ${proposalAccount.multisig.toString()}`);
    
    // Get the vault transaction
    const vaultTransactionPda = getVaultTransactionPda({
      multisigPda: proposalAccount.multisig,
      index: proposalAccount.vaultTransactionIndex,
      programId: new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf')
    });
    
    console.log(`\nVault Transaction PDA: ${vaultTransactionPda.toString()}\n`);
    
    // Get the vault transaction account
    const vaultTx = await accounts.VaultTransaction.fromAccountAddress(connection, vaultTransactionPda);
    
    console.log('📊 Vault Transaction Data:\n');
    console.log(`Status: ${vaultTx.status}`);
    console.log(`Execute Authority: ${vaultTx.executeAuthority?.toString() || 'N/A'}`);
    console.log(`Signers: ${vaultTx.signers.length}/${vaultTx.signers.length}`);
    vaultTx.signers.forEach((signer, i) => {
      console.log(`  ${i + 1}. ${signer.toString()}`);
    });
    
    // Check if executed
    if (vaultTx.status === 'Executed') {
      console.log(`\n✅ Vault Transaction Executed!`);
      console.log(`Execution Time: ${vaultTx.executedAt ? new Date(vaultTx.executedAt.toNumber() * 1000).toISOString() : 'N/A'}`);
      
      // Get execution transaction signature
      const signatures = await connection.getSignaturesForAddress(vaultTransactionPda, { limit: 20 });
      
      console.log('\n📋 Recent Transactions for Vault Transaction PDA:\n');
      for (const sig of signatures) {
        if (sig.signature === 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K') {
          continue; // Skip proposal approval
        }
        
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });
        
        if (tx && tx.meta && !tx.meta.err) {
          const logs = tx.meta.logMessages || [];
          const hasExecute = logs.some(log => 
            log.includes('Execute') || 
            log.includes('VaultTransactionExecute')
          );
          
          if (hasExecute) {
            console.log(`\n🎯 FOUND EXECUTION TRANSACTION: ${sig.signature}\n`);
            return sig.signature;
          }
        }
      }
    } else {
      console.log(`\n⚠️  Vault Transaction Status: ${vaultTx.status}`);
      console.log(`Not yet executed. Current signers: ${vaultTx.signers.length}`);
    }

  } catch (error) {
    console.error('❌ Error analyzing vault execution:', error.message);
    console.error(error.stack);
  }
}

analyzeVaultExecution().catch(console.error);


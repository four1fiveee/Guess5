const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getVaultTransactionPda, getMultisigPda } = require('@sqds/multisig');

const PROPOSAL_PDA = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';
const MATCH_ID = 'e2af9ab0-8d8d-4039-bc3e-64ca6d6b6633';
const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

async function findExecution() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Finding Execution Transaction from Vault\n');
  console.log(`Proposal PDA: ${PROPOSAL_PDA}`);
  console.log(`Match ID: ${MATCH_ID}\n`);

  try {
    // Step 1: Get proposal account
    const proposalPubkey = new PublicKey(PROPOSAL_PDA);
    console.log('📋 Step 1: Reading Proposal Account...\n');
    
    const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPubkey);
    
    console.log('✅ Proposal Account Data:');
    console.log(`  Status: ${proposalAccount.status}`);
    console.log(`  Vault Transaction Index: ${proposalAccount.vaultTransactionIndex}`);
    console.log(`  Multisig: ${proposalAccount.multisig.toString()}\n`);
    
    // Step 2: Get vault transaction PDA
    const vaultTransactionPda = getVaultTransactionPda({
      multisigPda: proposalAccount.multisig,
      index: proposalAccount.vaultTransactionIndex,
      programId: PROGRAM_ID
    });
    
    console.log(`📋 Step 2: Vault Transaction PDA: ${vaultTransactionPda.toString()}\n`);
    
    // Step 3: Get vault transaction account
    console.log('📋 Step 3: Reading Vault Transaction Account...\n');
    const vaultTx = await accounts.VaultTransaction.fromAccountAddress(connection, vaultTransactionPda);
    
    console.log('✅ Vault Transaction Data:');
    console.log(`  Status: ${vaultTx.status}`);
    console.log(`  Execute Authority: ${vaultTx.executeAuthority?.toString() || 'N/A'}`);
    console.log(`  Signers: ${vaultTx.signers.length}`);
    vaultTx.signers.forEach((signer, i) => {
      console.log(`    ${i + 1}. ${signer.toString()}`);
    });
    
    if (vaultTx.executedAt) {
      console.log(`  Executed At: ${new Date(vaultTx.executedAt.toNumber() * 1000).toISOString()}`);
    }
    
    // Step 4: Find execution transaction
    console.log('\n📋 Step 4: Searching for Execution Transaction...\n');
    const signatures = await connection.getSignaturesForAddress(vaultTransactionPda, { limit: 30 });
    
    console.log(`Found ${signatures.length} transactions for vault transaction PDA\n`);
    
    let executionTxSig = null;
    
    for (const sig of signatures) {
      // Skip the proposal approval transaction
      if (sig.signature === 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K') {
        console.log(`⏭️  Skipping proposal approval: ${sig.signature}`);
        continue;
      }
      
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });
      
      if (!tx || !tx.meta) continue;
      
      if (tx.meta.err) {
        console.log(`❌ Failed transaction: ${sig.signature}`);
        continue;
      }
      
      const logs = tx.meta.logMessages || [];
      const hasExecute = logs.some(log => 
        log.includes('VaultTransactionExecute') ||
        log.includes('Execute') ||
        log.includes('execute')
      );
      
      if (hasExecute) {
        console.log(`\n🎯 FOUND EXECUTION TRANSACTION: ${sig.signature}\n`);
        executionTxSig = sig.signature;
        break;
      }
    }
    
    if (!executionTxSig) {
      console.log('\n⚠️  Execution transaction not found in recent signatures');
      console.log('The transaction may not have executed yet, or it may be in a different account.\n');
      
      // Check if vault transaction is actually executed
      if (vaultTx.status === 'Executed') {
        console.log('✅ Vault transaction status shows "Executed"');
        console.log('But execution transaction signature not found in recent signatures.');
        console.log('Try checking the multisig or vault account for execution transactions.\n');
      }
    }
    
    return executionTxSig;

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

findExecution().then(sig => {
  if (sig) {
    console.log(`\n✅ Execution Transaction Signature: ${sig}`);
    console.log(`\n🔗 Explorer Link: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }
}).catch(console.error);


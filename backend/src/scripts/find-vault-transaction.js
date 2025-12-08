const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getTransactionPda, PROGRAM_ID } = require('@sqds/multisig');

const multisigPda = 'BcaVusSovzpaq7tauJmXRAqHsttqDHfoNdNAjZhZdJym';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function findVaultTransaction() {
  try {
    console.log('🔍 Searching for VaultTransaction accounts for multisig:', multisigPda);
    
    // Try transaction indices 0-10
    for (let i = 0; i <= 10; i++) {
      const [txPda] = getTransactionPda({
        multisigPda: new PublicKey(multisigPda),
        transactionIndex: BigInt(i),
        programId: PROGRAM_ID,
      });
      
      try {
        const vaultTx = await accounts.VaultTransaction.fromAccountAddress(conn, txPda);
        console.log(`✅ Found VaultTransaction at index ${i}:`, txPda.toString());
        if (vaultTx.message && vaultTx.message.accountKeys) {
          console.log(`   AccountKeys count: ${vaultTx.message.accountKeys.length}`);
        }
      } catch (e) {
        // Account doesn't exist, continue
      }
    }
    
    // Also check the proposal to see what transaction index it references
    const proposalPda = 'FFFSfatrJYCeJXtxa9s9qtdexkmfkDjbhRMFYr9e7T74';
    const proposal = await accounts.Proposal.fromAccountAddress(conn, new PublicKey(proposalPda));
    console.log('\n📋 Proposal references transactionIndex:', proposal.transactionIndex?.toString());
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    console.error(e.stack);
  }
}

findVaultTransaction();


const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getTransactionPda, PROGRAM_ID } = require('@sqds/multisig');

const proposalPda = 'FFFSfatrJYCeJXtxa9s9qtdexkmfkDjbhRMFYr9e7T74';
const multisigPda = 'BcaVusSovzpaq7tauJmXRAqHsttqDHfoNdNAjZhZdJym';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function checkProposal() {
  try {
    const proposal = await accounts.Proposal.fromAccountAddress(
      conn,
      new PublicKey(proposalPda)
    );

    console.log('✅ Proposal account found on-chain');
    console.log('Proposal PDA:', proposalPda);
    console.log('Transaction Index:', proposal.transactionIndex?.toString());
    console.log('Status:', proposal.status);

    // Check approved signers
    const approved = (proposal).approved || [];
    console.log('\n📋 Approved signers:', approved.length);
    approved.forEach((signer, i) => {
      const pubkey = signer?.key || signer?.pubkey || signer;
      const pubkeyStr = pubkey instanceof PublicKey ? pubkey.toString() : String(pubkey);
      console.log(`  [${i}] ${pubkeyStr}`);
    });

    // Derive VaultTransaction PDA
    const txIndex = proposal.transactionIndex ? BigInt(proposal.transactionIndex.toString()) : null;
    if (txIndex !== null) {
      const [txPda] = getTransactionPda({
        multisigPda: new PublicKey(multisigPda),
        transactionIndex: txIndex,
        programId: PROGRAM_ID,
      });
      console.log('\n🔍 Derived VaultTransaction PDA:', txPda.toString());
      
      try {
        const vaultTx = await accounts.VaultTransaction.fromAccountAddress(conn, txPda);
        console.log('✅ VaultTransaction found!');
        if (vaultTx.message && vaultTx.message.accountKeys) {
          console.log('AccountKeys count:', vaultTx.message.accountKeys.length);
          console.log('First 5 accountKeys:');
          vaultTx.message.accountKeys.slice(0, 5).forEach((key, i) => {
            const pk = key?.pubkey || key;
            const pkStr = pk instanceof PublicKey ? pk.toString() : String(pk);
            console.log(`  [${i}] ${pkStr} (writable: ${key?.isWritable || key?.writable}, signer: ${key?.isSigner || key?.signer})`);
          });
        }
      } catch (e) {
        console.error('❌ VaultTransaction fetch failed:', e.message);
      }
    }

  } catch (e) {
    console.error('❌ Error checking proposal:', e.message);
    console.error(e.stack);
  }
}

checkProposal();


const { VersionedTransaction, PublicKey, Connection } = require('@solana/web3.js');
const bs58 = require('bs58');

const txBase64 = process.argv[2];
const proposalPdaStr = process.argv[3];
const vaultPdaStr = process.argv[4];

if (!txBase64) {
  console.error('Usage: node analyze-new-transaction.js <txBase64> [proposalPda] [vaultPda]');
  process.exit(1);
}

try {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
  
  console.log('=== TRANSACTION ANALYSIS ===');
  console.log(`Signatures count: ${tx.signatures.length}`);
  
  const sig = tx.signatures[0];
  const isAllZeros = sig.every(b => b === 0);
  console.log(`First signature is all zeros: ${isAllZeros}`);
  
  if (!isAllZeros) {
    const sigBase58 = bs58.encode(sig);
    console.log(`\n✅ Transaction Signature: ${sigBase58}`);
    console.log(`\nTo check on-chain:`);
    console.log(`https://explorer.solana.com/tx/${sigBase58}?cluster=devnet`);
    
    // Check on-chain
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    connection.getSignatureStatus(sigBase58, { searchTransactionHistory: true })
      .then(status => {
        if (status.value) {
          console.log(`\n✅ Transaction WAS BROADCAST`);
          console.log(`Status: ${status.value.err ? 'FAILED' : 'SUCCESS'}`);
          if (status.value.err) {
            console.log(`Error: ${JSON.stringify(status.value.err)}`);
          }
        } else {
          console.log(`\n❌ Transaction NOT FOUND on-chain`);
        }
        process.exit(0);
      })
      .catch(err => {
        console.log(`\n⚠️  Could not check status: ${err.message}`);
        process.exit(0);
      });
  } else {
    console.log('\n❌ CRITICAL: Transaction is UNSIGNED (signature is all zeros)');
    console.log('This transaction was never signed and cannot be broadcast.');
    process.exit(1);
  }
  
  const msg = tx.message;
  console.log(`\nStatic account keys: ${msg.staticAccountKeys.length}`);
  
  if (proposalPdaStr && vaultPdaStr) {
    const proposalPda = new PublicKey(proposalPdaStr);
    const vaultPda = new PublicKey(vaultPdaStr);
    const hasProposal = msg.staticAccountKeys.some(k => k.equals(proposalPda));
    const hasVault = msg.staticAccountKeys.some(k => k.equals(vaultPda));
    console.log(`\nAccount Verification:`);
    console.log(`  Proposal PDA: ${hasProposal ? '✅ Present' : '❌ Missing'}`);
    console.log(`  Vault PDA: ${hasVault ? '✅ Present' : '❌ Missing'}`);
  }
  
  console.log(`\nAll accounts:`);
  msg.staticAccountKeys.forEach((k, i) => {
    console.log(`  ${i}: ${k.toString()}`);
  });
  
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}


const { VersionedTransaction, PublicKey, Connection } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');

const txBase64 = process.argv[2];
const proposalPdaStr = process.argv[3];
const vaultPdaStr = process.argv[4];
const outputFile = process.argv[5] || '/tmp/tx_analysis_result.txt';

let output = [];

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  output.push(line);
  console.log(line);
}

if (!txBase64) {
  log('Usage: node check-tx-signature.js <txBase64> [proposalPda] [vaultPda]');
  process.exit(1);
}

(async () => {
  try {
    const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
    
    log('=== TRANSACTION ANALYSIS ===');
    log(`Signatures count: ${tx.signatures.length}`);
    
    const sig = tx.signatures[0];
    const isAllZeros = sig.every(b => b === 0);
    log(`First signature is all zeros: ${isAllZeros}`);
    
    if (!isAllZeros) {
      const sigBase58 = bs58.encode(sig);
      log(`Transaction Signature: ${sigBase58}`);
      log(`\nTo check on-chain:`);
      log(`https://explorer.solana.com/tx/${sigBase58}?cluster=devnet`);
      
      // Check on-chain
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
      try {
        const status = await connection.getSignatureStatus(sigBase58, { searchTransactionHistory: true });
        if (status.value) {
          log(`\n✅ Transaction WAS BROADCAST`);
          log(`Status: ${status.value.err ? 'FAILED' : 'SUCCESS'}`);
          if (status.value.err) {
            log(`Error: ${JSON.stringify(status.value.err)}`);
          }
        } else {
          log(`\n❌ Transaction NOT FOUND on-chain`);
        }
      } catch (err) {
        log(`\n⚠️  Could not check status: ${err.message}`);
      }
    } else {
      log('\n❌ CRITICAL: Transaction is UNSIGNED (signature is all zeros)');
      log('This transaction was never signed and cannot be broadcast.');
    }
    
    const msg = tx.message;
    log(`\nStatic account keys: ${msg.staticAccountKeys.length}`);
    
    if (proposalPdaStr && vaultPdaStr) {
      const proposalPda = new PublicKey(proposalPdaStr);
      const vaultPda = new PublicKey(vaultPdaStr);
      const hasProposal = msg.staticAccountKeys.some(k => k.equals(proposalPda));
      const hasVault = msg.staticAccountKeys.some(k => k.equals(vaultPda));
      log(`\nAccount Verification:`);
      log(`  Proposal PDA: ${hasProposal ? '✅ Present' : '❌ Missing'}`);
      log(`  Vault PDA: ${hasVault ? '✅ Present' : '❌ Missing'}`);
    }
    
    log(`\nAll accounts:`);
    msg.staticAccountKeys.forEach((k, i) => {
      log(`  ${i}: ${k.toString()}`);
    });
    
    // Write to file
    fs.writeFileSync(outputFile, output.join('\n'));
    log(`\n✅ Results saved to ${outputFile}`);
    
  } catch (error) {
    log(`Error: ${error.message}`);
    log(error.stack);
    fs.writeFileSync(outputFile, output.join('\n'));
    process.exit(1);
  }
})();


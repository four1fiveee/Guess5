/**
 * Simple script to decode transaction and extract signature
 */

const { VersionedTransaction, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');

const transactionBase64 = process.argv[2];

if (!transactionBase64) {
  console.error('Usage: node decode-transaction-simple.js <transactionBase64>');
  process.exit(1);
}

try {
  console.log('Decoding transaction...');
  const transactionBuffer = Buffer.from(transactionBase64, 'base64');
  console.log(`Buffer length: ${transactionBuffer.length} bytes`);
  
  const transaction = VersionedTransaction.deserialize(transactionBuffer);
  console.log('✅ Transaction deserialized');
  
  const message = transaction.message;
  const staticAccountKeys = message.staticAccountKeys;
  console.log(`Static account keys: ${staticAccountKeys.length}`);
  
  // Extract signature
  const signatures = transaction.signatures;
  const validSignatures = signatures.filter(sig => sig && !sig.every(b => b === 0));
  
  if (validSignatures.length > 0) {
    const signature = validSignatures[0];
    const signatureBase58 = bs58.encode(signature);
    console.log(`\n✅ Transaction Signature: ${signatureBase58}`);
    console.log(`\nTo check on-chain, use:`);
    console.log(`solana confirm ${signatureBase58} --url devnet`);
    console.log(`Or visit: https://explorer.solana.com/tx/${signatureBase58}?cluster=devnet`);
    
    // Check accounts
    const proposalPda = process.argv[3];
    const vaultPda = process.argv[4];
    
    if (proposalPda && vaultPda) {
      const hasProposal = staticAccountKeys.some(k => k.equals(new PublicKey(proposalPda)));
      const hasVault = staticAccountKeys.some(k => k.equals(new PublicKey(vaultPda)));
      console.log(`\nAccount Verification:`);
      console.log(`  Proposal PDA (${proposalPda}): ${hasProposal ? '✅ Present' : '❌ Missing'}`);
      console.log(`  Vault PDA (${vaultPda}): ${hasVault ? '✅ Present' : '❌ Missing'}`);
    }
    
    // List all accounts
    console.log(`\nAll accounts in transaction:`);
    staticAccountKeys.forEach((key, idx) => {
      console.log(`  ${idx}: ${key.toString()}`);
    });
  } else {
    console.log('❌ No valid signatures found');
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}


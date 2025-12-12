/**
 * Script to decode and analyze a signed transaction
 * Used to diagnose proposal signing issues
 */

const { Connection, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { accounts } = require('@sqds/multisig');

const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

async function analyzeTransaction(transactionBase64, matchId, proposalId, vaultAddress) {
  console.error('Starting transaction analysis...'); // Use stderr for debugging
  console.log('='.repeat(80));
  console.log('TRANSACTION ANALYSIS REPORT');
  console.log('='.repeat(80));
  console.log(`Match ID: ${matchId}`);
  console.log(`Proposal ID: ${proposalId}`);
  console.log(`Vault Address: ${vaultAddress}`);
  console.log(`Transaction (base64): ${transactionBase64.substring(0, 100)}...`);
  console.log('');

  try {
    // Decode transaction
    const transactionBuffer = Buffer.from(transactionBase64, 'base64');
    console.log('✅ Transaction decoded from base64');
    console.log(`   Buffer length: ${transactionBuffer.length} bytes`);
    console.log('');

    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    console.log('✅ Transaction deserialized successfully');
    console.log('');

    // Extract transaction details
    const message = transaction.message;
    const staticAccountKeys = message.staticAccountKeys;
    const addressTableLookups = message.addressTableLookups || [];
    
    console.log('📋 TRANSACTION STRUCTURE:');
    console.log(`   Version: ${transaction.version}`);
    console.log(`   Static Account Keys: ${staticAccountKeys.length}`);
    console.log(`   Address Table Lookups: ${addressTableLookups.length}`);
    console.log('');

    // Analyze instructions
    console.log('📝 INSTRUCTIONS:');
    const instructions = message.compiledInstructions || [];
    console.log(`   Instruction count: ${instructions.length}`);
    
    instructions.forEach((ix, idx) => {
      console.log(`   Instruction ${idx + 1}:`);
      console.log(`     Program ID Index: ${ix.programIdIndex}`);
      const programId = staticAccountKeys[ix.programIdIndex];
      console.log(`     Program ID: ${programId.toString()}`);
      console.log(`     Account Indices: [${ix.accountKeyIndexes.join(', ')}]`);
      console.log(`     Data Length: ${ix.data.length} bytes`);
      
      // Check if this is a Squads instruction
      const SQUADS_PROGRAM_ID = 'SQDS4ep65H869MbKKs9q3zHMhVZqWUYFz7vqJzJZJZJZ';
      if (programId.toString() === SQUADS_PROGRAM_ID || 
          programId.toString() === 'SqDS4ep65H869MbKKs9q3zHMhVZqWUYFz7vqJzJZJZJZ') {
        console.log(`     ⚠️  SQUADS INSTRUCTION DETECTED`);
      }
    });
    console.log('');

    // Analyze signers
    console.log('✍️  SIGNERS:');
    const signers = transaction.signatures;
    console.log(`   Signature count: ${signers.length}`);
    signers.forEach((sig, idx) => {
      if (sig && !sig.every(b => b === 0)) {
        console.log(`   Signer ${idx + 1}: ${Buffer.from(sig).toString('base64').substring(0, 20)}...`);
      } else {
        console.log(`   Signer ${idx + 1}: [NOT SIGNED]`);
      }
    });
    console.log('');

    // Extract accounts
    console.log('🔑 ACCOUNTS:');
    staticAccountKeys.forEach((key, idx) => {
      console.log(`   Account ${idx}: ${key.toString()}`);
    });
    console.log('');

    // Check for proposal-related accounts
    console.log('🔍 PROPOSAL ANALYSIS:');
    const proposalPda = new PublicKey(proposalId);
    const vaultPda = new PublicKey(vaultAddress);
    
    const hasProposalPda = staticAccountKeys.some(k => k.equals(proposalPda));
    const hasVaultPda = staticAccountKeys.some(k => k.equals(vaultPda));
    
    console.log(`   Proposal PDA in transaction: ${hasProposalPda ? '✅ YES' : '❌ NO'}`);
    console.log(`   Vault PDA in transaction: ${hasVaultPda ? '✅ YES' : '❌ NO'}`);
    console.log('');

    // Try to extract transactionIndex from proposal account
    console.log('🔍 EXTRACTING TRANSACTION INDEX:');
    try {
      const proposalAccount = await accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );
      const transactionIndex = proposalAccount.transactionIndex;
      console.log(`   ✅ On-chain Proposal transactionIndex: ${transactionIndex ? transactionIndex.toString() : 'NOT FOUND'}`);
      const status = proposalAccount.status || {};
      console.log(`   Proposal Status: ${status.__kind || 'UNKNOWN'}`);
      const approved = proposalAccount.approved || [];
      console.log(`   Approved Signers: ${approved.map(s => s.toString()).join(', ')}`);
      
      // Derive VaultTransaction PDA
      const { getTransactionPda } = require('@sqds/multisig');
      const { PROGRAM_ID } = require('@sqds/multisig');
      const programId = process.env.SQUADS_PROGRAM_ID 
        ? new PublicKey(process.env.SQUADS_PROGRAM_ID)
        : PROGRAM_ID;
      
      const [transactionPda] = getTransactionPda({
        multisigPda: vaultPda,
        index: BigInt(transactionIndex.toString()),
        programId: programId,
      });
      
      console.log(`   VaultTransaction PDA (derived): ${transactionPda.toString()}`);
      
      // Check if VaultTransaction exists
      try {
        const vaultTxAccount = await accounts.VaultTransaction.fromAccountAddress(
          connection,
          transactionPda
        );
        console.log(`   ✅ VaultTransaction account EXISTS on-chain`);
        console.log(`   VaultTransaction has message: ${!!vaultTxAccount.message}`);
        if (vaultTxAccount.message && vaultTxAccount.message.accountKeys) {
          console.log(`   VaultTransaction accountKeys count: ${vaultTxAccount.message.accountKeys.length}`);
        }
      } catch (vtError) {
        console.log(`   ❌ VaultTransaction account DOES NOT EXIST on-chain`);
        console.log(`   Error: ${vtError.message}`);
      }
      
    } catch (proposalError) {
      console.log(`   ❌ Failed to fetch proposal account: ${proposalError.message}`);
    }
    console.log('');

    // Extract transaction signature and check broadcast status
    console.log('📡 BROADCAST STATUS:');
    try {
      // Extract signature from transaction
      const signatures = transaction.signatures;
      const validSignatures = signatures.filter(sig => sig && !sig.every(b => b === 0));
      
      if (validSignatures.length > 0) {
        const signature = validSignatures[0];
        // Use Solana's base58 encoding (bs58 is available via @solana/web3.js)
        let signatureBase58;
        try {
          // Try using bs58 if available
          signatureBase58 = require('bs58').encode(signature);
        } catch {
          // Fallback: use Buffer with base58 encoding
          // Note: Node.js doesn't have native base58, so we'll use a workaround
          // Convert to base64 first, then note that we need bs58
          const base64 = Buffer.from(signature).toString('base64');
          console.log(`   ⚠️  bs58 not available, using base64: ${base64}`);
          console.log(`   Note: Install bs58 package for proper base58 encoding`);
          // For now, we'll skip the on-chain check if bs58 isn't available
          signatureBase58 = null;
        }
        
        if (signatureBase58) {
          console.log(`   Transaction Signature: ${signatureBase58}`);
          console.log('');
          
          // Check if transaction was broadcast on-chain
          console.log('   🔍 Checking on-chain status...');
          try {
            const txStatus = await connection.getSignatureStatus(signatureBase58, {
              searchTransactionHistory: true,
            });
            
            if (txStatus.value) {
              console.log('   ✅ Transaction WAS BROADCAST on-chain');
              console.log(`   Status: ${txStatus.value.err ? 'FAILED' : 'SUCCESS'}`);
              if (txStatus.value.err) {
                console.log(`   Error: ${JSON.stringify(txStatus.value.err)}`);
              }
              if (txStatus.value.confirmationStatus) {
                console.log(`   Confirmation Status: ${txStatus.value.confirmationStatus}`);
              }
              if (txStatus.value.slot) {
                console.log(`   Slot: ${txStatus.value.slot}`);
              }
              
              // Try to get transaction details
              try {
                const txDetails = await connection.getTransaction(signatureBase58, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0,
                });
                
                if (txDetails) {
                  console.log(`   ✅ Transaction details retrieved`);
                  console.log(`   Block Time: ${txDetails.blockTime ? new Date(txDetails.blockTime * 1000).toISOString() : 'N/A'}`);
                  console.log(`   Slot: ${txDetails.slot}`);
                  console.log(`   Fee: ${txDetails.meta?.fee || 'N/A'} lamports`);
                  if (txDetails.meta?.err) {
                    console.log(`   ❌ Transaction Error: ${JSON.stringify(txDetails.meta.err)}`);
                  } else {
                    console.log(`   ✅ Transaction executed successfully`);
                  }
                }
              } catch (txDetailsError) {
                console.log(`   ⚠️  Could not retrieve transaction details: ${txDetailsError.message}`);
              }
            } else {
              console.log('   ❌ Transaction NOT FOUND on-chain');
              console.log('   This means the transaction was never broadcast or was dropped');
            }
          } catch (statusError) {
            console.log(`   ⚠️  Could not check transaction status: ${statusError.message}`);
            console.log(`   This may indicate the transaction was never broadcast`);
          }
        } else {
          console.log('   ⚠️  Could not encode signature (bs58 not available)');
          console.log('   Transaction signature extraction failed');
        }
      } else {
        console.log('   ❌ No valid signatures found in transaction');
        console.log('   Transaction may not be properly signed');
      }
    } catch (sigError) {
      console.log(`   ⚠️  Could not extract signature: ${sigError.message}`);
    }
    console.log('');

    // Summary
    console.log('='.repeat(80));
    console.log('SUMMARY:');
    console.log('='.repeat(80));
    console.log(`✅ Transaction Structure: Valid`);
    console.log(`✅ Deserialization: Success`);
    console.log(`${hasProposalPda ? '✅' : '❌'} Proposal PDA: ${hasProposalPda ? 'Present' : 'Missing'}`);
    console.log(`${hasVaultPda ? '✅' : '❌'} Vault PDA: ${hasVaultPda ? 'Present' : 'Missing'}`);
    console.log(`   Instructions: ${instructions.length}`);
    console.log(`   Signers: ${signers.filter(s => s && !s.every(b => b === 0)).length}`);
    console.log('');

  } catch (error) {
    console.error('❌ ANALYSIS FAILED:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    throw error;
  }
}

// Run analysis if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node analyze-signed-transaction.js <transactionBase64> <matchId> <proposalId> <vaultAddress>');
    process.exit(1);
  }

  const [transactionBase64, matchId, proposalId, vaultAddress] = args;
  
  analyzeTransaction(transactionBase64, matchId, proposalId, vaultAddress)
    .then(() => {
      console.log('✅ Analysis complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Analysis failed:', error);
      process.exit(1);
    });
}

module.exports = { analyzeTransaction };


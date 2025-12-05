#!/usr/bin/env node
/**
 * Diagnostic script to check on-chain proposal status and diagnose why
 * a proposal is stuck in Approved state and not transitioning to ExecuteReady.
 * 
 * Usage: node diagnose-proposal.js <vaultAddress> <proposalId> [transactionIndex]
 * Example: node diagnose-proposal.js 5xe3hphUTh6SEthJYbWTsf34LRW3MEsyMYmbGTc23cuR DV2tmzZ1T9nVnCYC3NNfNXgwbR1uAsCjk8bgGHNsb28Y
 */

const { Connection, PublicKey, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const { accounts, instructions, getProposalPda, getTransactionPda, getVaultPda } = require('@sqds/multisig');

const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'); // Devnet

async function diagnoseProposal(vaultAddress, proposalId, transactionIndex = null) {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    const multisigAddress = new PublicKey(vaultAddress);
    let proposalPda;
    let txIndex;

    // Parse proposalId - could be PDA or transactionIndex
    try {
      proposalPda = new PublicKey(proposalId);
      console.log('📋 Using proposalId as PDA:', proposalPda.toString());
    } catch (pdaError) {
      // Try as transactionIndex
      try {
        txIndex = BigInt(proposalId);
        const [derivedPda] = getProposalPda({
          multisigPda: multisigAddress,
          transactionIndex: txIndex,
          programId: PROGRAM_ID,
        });
        proposalPda = derivedPda;
        console.log('📋 Derived proposal PDA from transactionIndex:', proposalPda.toString());
      } catch (bigIntError) {
        console.error('❌ Could not parse proposalId as PDA or transactionIndex');
        throw bigIntError;
      }
    }

    // If transactionIndex was provided as separate arg, use it
    if (transactionIndex) {
      txIndex = BigInt(transactionIndex);
    }

    // Fetch Proposal account
    console.log('\n🔍 Fetching Proposal account...');
    const proposalAccount = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda,
      'confirmed'
    );

    // Extract transactionIndex from proposal if not already known
    if (!txIndex) {
      txIndex = proposalAccount.transactionIndex;
    }

    const statusKind = proposalAccount.status?.__kind || 'Unknown';
    const approved = proposalAccount.approved || [];
    const approvedSigners = approved.map((a) => a?.toString?.() || String(a));

    console.log('\n📊 PROPOSAL ACCOUNT STATUS:');
    console.log('  Proposal PDA:', proposalPda.toString());
    console.log('  Transaction Index:', txIndex.toString());
    console.log('  Status:', statusKind);
    console.log('  Approved Signers:', approvedSigners);
    console.log('  Approved Count:', approvedSigners.length);

    // Fetch Multisig to get threshold
    const multisig = await accounts.Multisig.fromAccountAddress(
      connection,
      multisigAddress,
      'confirmed'
    );
    const threshold = multisig.threshold;
    console.log('  Multisig Threshold:', threshold.toString());
    console.log('  Needs Signatures:', Math.max(0, Number(threshold) - approvedSigners.length));

    // Check if proposal should be ExecuteReady
    const hasEnoughSignatures = approvedSigners.length >= Number(threshold);
    console.log('\n✅ Signature Check:');
    console.log('  Has Enough Signatures:', hasEnoughSignatures);
    console.log('  Should be ExecuteReady:', hasEnoughSignatures && statusKind === 'Approved');

    // Fetch VaultTransaction account
    const [transactionPda] = getTransactionPda({
      multisigPda: multisigAddress,
      index: txIndex,
      programId: PROGRAM_ID,
    });

    console.log('\n🔍 Fetching VaultTransaction account...');
    console.log('  Transaction PDA:', transactionPda.toString());

    try {
      const transactionAccount = await accounts.VaultTransaction.fromAccountAddress(
        connection,
        transactionPda,
        'confirmed'
      );

      console.log('\n📋 VAULT TRANSACTION ACCOUNT:');
      console.log('  Transaction PDA:', transactionPda.toString());
      console.log('  Vault Index:', transactionAccount.vaultIndex?.toString() || 'N/A');
      console.log('  Has Message:', !!transactionAccount.message);
      
      if (transactionAccount.message) {
        const message = transactionAccount.message;
        console.log('  Message Keys:', Object.keys(message));
        console.log('  Instruction Count:', message.instructions?.length || 0);
        console.log('  Account Keys Count:', message.accountKeys?.length || 0);
        
        // Log inner instructions
        if (message.instructions && message.instructions.length > 0) {
          console.log('\n📝 INNER INSTRUCTIONS:');
          message.instructions.forEach((ix, idx) => {
            const programIdIndex = ix.programIdIndex;
            const programId = message.accountKeys[programIdIndex]?.toString() || `Index:${programIdIndex}`;
            console.log(`  Instruction ${idx}:`);
            console.log(`    Program ID: ${programId}`);
            console.log(`    Account Indices: ${ix.accounts?.join(', ') || 'N/A'}`);
            console.log(`    Data Length: ${ix.data?.length || 0} bytes`);
          });
        }
      }
    } catch (txError) {
      console.error('❌ Error fetching VaultTransaction account:', txError.message);
      console.error('  This might indicate the transaction account is missing or invalid');
    }

    // Try to simulate execution
    console.log('\n🧪 SIMULATING EXECUTION...');
    try {
      const executor = approvedSigners[0]; // Use first signer as executor
      const executorPubkey = new PublicKey(executor);

      // Build execute instruction
      const executeIx = instructions.vaultTransactionExecute({
        multisig: multisigAddress,
        transaction: transactionPda,
        member: executorPubkey,
      });

      // Build transaction
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: executorPubkey,
        recentBlockhash: blockhash,
        instructions: [executeIx],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);

      // Simulate
      const simulation = await connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        sigVerify: false,
      });

      console.log('\n📊 SIMULATION RESULTS:');
      console.log('  Error:', simulation.value.err ? JSON.stringify(simulation.value.err) : 'None');
      console.log('  Compute Units Consumed:', simulation.value.unitsConsumed || 'N/A');
      console.log('  Log Count:', simulation.value.logs?.length || 0);

      if (simulation.value.err) {
        console.log('\n❌ SIMULATION FAILED - This explains why proposal is stuck:');
        console.log('  Error:', JSON.stringify(simulation.value.err, null, 2));
        if (simulation.value.logs && simulation.value.logs.length > 0) {
          console.log('\n  Logs (last 20):');
          simulation.value.logs.slice(-20).forEach((log) => {
            console.log(`    ${log}`);
          });
        }
      } else {
        console.log('\n✅ SIMULATION PASSED - Proposal should be executable');
        if (simulation.value.logs && simulation.value.logs.length > 0) {
          console.log('\n  Logs (last 10):');
          simulation.value.logs.slice(-10).forEach((log) => {
            console.log(`    ${log}`);
          });
        }
      }
    } catch (simError) {
      console.error('❌ Error simulating execution:', simError.message);
      console.error('  Stack:', simError.stack);
    }

    // Summary
    console.log('\n📋 DIAGNOSIS SUMMARY:');
    console.log('  Proposal Status:', statusKind);
    console.log('  Has Enough Signatures:', hasEnoughSignatures);
    console.log('  Expected Status:', hasEnoughSignatures ? 'ExecuteReady' : 'Approved');
    console.log('  Actual Status:', statusKind);
    
    if (hasEnoughSignatures && statusKind === 'Approved') {
      console.log('\n⚠️  ISSUE: Proposal has enough signatures but is still in Approved state.');
      console.log('  Possible causes:');
      console.log('    1. Validation step failed (check simulation logs above)');
      console.log('    2. Missing required accounts in transaction');
      console.log('    3. Inner instruction requires a signer that is not present');
      console.log('    4. PDA derivation mismatch');
      console.log('    5. Program constraint violation');
    } else if (hasEnoughSignatures && statusKind === 'ExecuteReady') {
      console.log('\n✅ Proposal is ready for execution');
    } else if (!hasEnoughSignatures) {
      console.log('\n⏳ Proposal needs more signatures');
      console.log(`  Current: ${approvedSigners.length}/${threshold}`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse command line arguments
const vaultAddress = process.argv[2];
const proposalId = process.argv[3];
const transactionIndex = process.argv[4] || null;

if (!vaultAddress || !proposalId) {
  console.error('❌ Usage: node diagnose-proposal.js <vaultAddress> <proposalId> [transactionIndex]');
  console.error('Example: node diagnose-proposal.js 5xe3hphUTh6SEthJYbWTsf34LRW3MEsyMYmbGTc23cuR DV2tmzZ1T9nVnCYC3NNfNXgwbR1uAsCjk8bgGHNsb28Y');
  process.exit(1);
}

diagnoseProposal(vaultAddress, proposalId, transactionIndex).then(() => {
  console.log('\n✅ Diagnosis complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


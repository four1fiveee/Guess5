// Diagnostic script to inspect Squads proposal and vault transaction state
// Run: node backend/scripts/inspect-squads-state.js <matchId>

const { Connection, PublicKey, SystemProgram } = require('@solana/web3.js');
const { Program, AnchorProvider } = require('@coral-xyz/anchor');
const fetch = require('node-fetch');

const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
const SQUADS_PROGRAM_ID_STR = process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const connection = new Connection(RPC, 'confirmed');
const SQUADS_PROGRAM_ID = new PublicKey(SQUADS_PROGRAM_ID_STR);

// Helper to fetch IDL
async function fetchIdl() {
  try {
    // Try on-chain first
    const dummyKeypair = { publicKey: PublicKey.default, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs };
    const provider = new AnchorProvider(connection, dummyKeypair, {});
    const onChainIdl = await Program.fetchIdl(SQUADS_PROGRAM_ID, provider);
    if (onChainIdl) {
      console.log('✅ Fetched on-chain IDL instructions:', (onChainIdl.instructions || []).map(i => i.name));
      return onChainIdl;
    }
  } catch (err) {
    // Continue to package fallback
  }
  
  // Fallback: try loading from package
  try {
    const idlPath = require.resolve('@sqds/multisig/idl.json');
    const fs = require('fs');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    console.log('✅ Loaded IDL from package instructions:', (idl.instructions || []).map(i => i.name));
    return idl;
  } catch (err) {
    console.warn('⚠️ No IDL found on-chain or in package');
    return null;
  }
}

// Fetch proposal account and inspect transactions
async function inspectProposal(proposalPdaStr) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📋 INSPECTING PROPOSAL ACCOUNT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Proposal PDA:', proposalPdaStr);
  
  const proposalPda = new PublicKey(proposalPdaStr);

  // Try using @sqds/multisig accounts module first
  try {
    const { accounts } = require('@sqds/multisig');
    const decoded = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
    
    console.log('\n✅ Proposal decoded successfully using @sqds/multisig accounts');
    
    // Check for transactions field
    const transactions = decoded.transactions || decoded.transactionIndexes || decoded.transactionList || null;
    const transactionCount = Array.isArray(transactions) ? transactions.length : (transactions ? 1 : 0);
    
    console.log('\n📊 Transaction Linking:');
    console.log('  - transactions field:', transactions);
    console.log('  - transactionCount:', transactionCount);
    console.log('  - transactionIndex:', decoded.transactionIndex?.toString() || decoded.index?.toString() || 'N/A');
    
    if (transactionCount === 0) {
      console.log('\n❌ CRITICAL: Proposal has ZERO linked transactions!');
      console.log('   This means the proposal was created without linking the vault transaction.');
    } else {
      console.log('\n✅ Proposal has linked transactions');
    }
    
    console.log('\n📊 Proposal Status:');
    console.log('  - status:', decoded.status);
    console.log('  - statusKind:', decoded.status?.__kind || decoded.statusKind || 'N/A');
    console.log('  - approved:', decoded.approved || []);
    console.log('  - approvedCount:', Array.isArray(decoded.approved) ? decoded.approved.length : 0);
    
    console.log('\n📋 Full Proposal Data:');
    console.log(JSON.stringify(decoded, (key, value) => {
      if (value && typeof value === 'object' && value.constructor === PublicKey) {
        return value.toString();
      }
      if (value && typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2));
    
    return decoded;
  } catch (e) {
    console.log('⚠️ Failed to decode with @sqds/multisig accounts, trying IDL...');
    
    // Fallback to IDL
    const idl = await fetchIdl();
    if (!idl) {
      console.error('❌ Cannot inspect proposal - IDL not available');
      // Try raw account
      try {
        const raw = await connection.getAccountInfo(proposalPda);
        console.log('\n📊 Raw Account Info:');
        console.log('  - exists:', !!raw);
        console.log('  - data length:', raw?.data?.length || 0);
        console.log('  - owner:', raw?.owner?.toString() || 'N/A');
      } catch (e2) {
        console.error('❌ Failed to get raw account:', e2?.message || String(e2));
      }
      return null;
    }

    const dummyKeypair = { publicKey: PublicKey.default, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs };
    const provider = new AnchorProvider(connection, dummyKeypair, {});
    const program = new Program(idl, SQUADS_PROGRAM_ID, provider);

    try {
      if (program.account.proposal) {
        const decoded = await program.account.proposal.fetch(proposalPda);
        console.log('\n✅ Proposal decoded successfully using IDL');
        // Same processing as above...
        return decoded;
      }
    } catch (e2) {
      console.error('❌ Failed to decode proposal:', e2?.message || String(e2));
    }
  }

  return null;
}

// Fetch vault transaction account and inspect approvals
async function inspectVaultTransaction(txPdaStr) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('💰 INSPECTING VAULT TRANSACTION ACCOUNT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Transaction PDA:', txPdaStr);
  
  const txPda = new PublicKey(txPdaStr);

  // Try using @sqds/multisig accounts module first
  try {
    const { accounts } = require('@sqds/multisig');
    const decoded = await accounts.VaultTransaction.fromAccountAddress(connection, txPda);
    
    console.log('\n✅ Vault transaction decoded successfully using @sqds/multisig accounts');
    console.log('Account keys:', Object.keys(decoded));
    
    // Check for approval-related fields
    const status = decoded.status ?? decoded.state ?? decoded.executed ?? null;
    const approvals = decoded.approvals ?? decoded.signatures ?? decoded.approvers ?? [];
    const approvalCount = Array.isArray(approvals) ? approvals.length : (decoded.approval_count ?? decoded.approvals_count ?? decoded.required_approvals ?? 0);
    const threshold = decoded.threshold ?? decoded.required_approvals ?? decoded.approval_threshold ?? null;
    const index = decoded.index ?? decoded.transactionIndex ?? null;
    
    console.log('\n📊 Approval Status:');
    console.log('  - status:', status);
    console.log('  - approvals array:', approvals);
    console.log('  - approvalCount:', approvalCount);
    console.log('  - threshold:', threshold);
    console.log('  - index:', index?.toString() || 'N/A');
    
    if (threshold !== null && threshold > 0) {
      console.log('\n⚠️ Vault transaction has approval threshold:', threshold);
      console.log('   Current approvals:', approvalCount, '/', threshold);
      if (approvalCount < threshold) {
        console.log('   ❌ APPROVALS REQUIRED: Vault transaction needs', threshold - approvalCount, 'more approval(s)');
      } else {
        console.log('   ✅ Approval threshold met');
      }
    } else {
      console.log('\n✅ No approval threshold found - vault transaction does not require approvals');
    }
    
    console.log('\n📋 Full Vault Transaction Data:');
    console.log(JSON.stringify(decoded, (key, value) => {
      if (value && typeof value === 'object' && value.constructor === PublicKey) {
        return value.toString();
      }
      if (value && typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2));
    
    return decoded;
  } catch (e) {
    console.log('⚠️ Failed to decode with @sqds/multisig accounts, trying IDL...');
    
    // Fallback to IDL
    const idl = await fetchIdl();
    if (!idl) {
      console.error('❌ Cannot inspect vault transaction - IDL not available');
      // Try raw account
      try {
        const info = await connection.getAccountInfo(txPda);
        console.log('\n📊 Raw Transaction Account Info:');
        console.log('  - exists:', !!info);
        console.log('  - data length:', info?.data?.length || 0);
        console.log('  - owner:', info?.owner?.toString() || 'N/A');
      } catch (e2) {
        console.error('❌ Failed to get raw account:', e2?.message || String(e2));
      }
      return null;
    }

    const dummyKeypair = { publicKey: PublicKey.default, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs };
    const provider = new AnchorProvider(connection, dummyKeypair, {});
    const program = new Program(idl, SQUADS_PROGRAM_ID, provider);

    try {
      const possible = ['vaultTransaction', 'transaction', 'vaultTransactionAccount'];
      for (const name of possible) {
        if (program.account[name]) {
          try {
            const decoded = await program.account[name].fetch(txPda);
            console.log(`\n✅ Decoded as '${name}' using IDL`);
            // Same processing as above...
            return decoded;
          } catch (e2) {
            // Not this account type, try next
          }
        }
      }
      console.warn('⚠️ Could not decode vault transaction with any known account type');
    } catch (err) {
      console.error('❌ inspectVaultTransaction error:', err?.message || String(err));
    }
  }

  return null;
}

// List on-chain IDL instructions
async function listOnchainIdlInstructions() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📋 ON-CHAIN IDL INSTRUCTIONS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const idl = await fetchIdl();
  if (!idl) {
    console.error('❌ Cannot list instructions - IDL not available');
    return;
  }

  const allInstructions = (idl.instructions || []).map(i => i.name);
  console.log('\n📋 All IDL Instructions:');
  console.log(allInstructions.join(', '));

  // Find approve-like instructions
  const approves = (idl.instructions || []).filter(i => 
    /approve|approve_transaction|transaction_approve|vault|tx/i.test(i.name)
  );
  
  console.log('\n🔍 Approve-like Instructions:');
  if (approves.length > 0) {
    approves.forEach(inst => {
      console.log(`  - ${inst.name}`);
      console.log(`    Accounts: ${(inst.accounts || []).map(a => a.name).join(', ')}`);
      console.log(`    Args: ${(inst.args || []).map(a => a.name).join(', ') || 'none'}`);
    });
  } else {
    console.log('  ❌ No approve-like instructions found in IDL');
  }
}

// Main execution
async function main() {
  const matchId = process.argv[2];
  if (!matchId) {
    console.error('Usage: node inspect-squads-state.js <matchId>');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 SQUADS STATE INSPECTION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Match ID:', matchId);
  console.log('RPC:', RPC);
  console.log('Squads Program ID:', SQUADS_PROGRAM_ID.toString());

  // Fetch match data to get PDAs
  try {
    const apiUrl = process.env.API_URL || 'https://guess5.onrender.com';
    const response = await fetch(`${apiUrl}/api/match/status/${matchId}`);
    const matchData = await response.json();
    
    if ((!matchData.squadsVaultAddress && !matchData.squadsVaultPda) || (!matchData.payoutProposalId && !matchData.tieRefundProposalId)) {
      console.error('❌ Match data missing squadsVaultAddress or proposalId');
      console.error('Match data keys:', Object.keys(matchData));
      process.exit(1);
    }

    const { getProposalPda, getTransactionPda } = require('@sqds/multisig');
    // Use squadsVaultAddress (multisig address) not squadsVaultPda (vault PDA)
    const multisigAddress = new PublicKey(matchData.squadsVaultAddress || matchData.squadsVaultPda);
    const proposalId = matchData.payoutProposalId || matchData.tieRefundProposalId;
    const transactionIndex = BigInt(proposalId);
    
    const [proposalPda] = getProposalPda({
      multisigPda: multisigAddress,
      transactionIndex: transactionIndex,
      programId: SQUADS_PROGRAM_ID,
    });
    
    const [transactionPda] = getTransactionPda({
      multisigPda: multisigAddress,
      index: transactionIndex,
      programId: SQUADS_PROGRAM_ID,
    });

    console.log('\n📊 Derived PDAs:');
    console.log('  - Multisig:', multisigAddress.toString());
    console.log('  - Proposal PDA:', proposalPda.toString());
    console.log('  - Transaction PDA:', transactionPda.toString());
    console.log('  - Transaction Index:', transactionIndex.toString());

    // 1. List IDL instructions
    await listOnchainIdlInstructions();

    // 2. Inspect proposal
    await inspectProposal(proposalPda.toString());

    // 3. Inspect vault transaction
    await inspectVaultTransaction(transactionPda.toString());

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('✅ Inspection complete');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error?.message || String(error));
    console.error(error?.stack);
    process.exit(1);
  }
}

main().catch(console.error);

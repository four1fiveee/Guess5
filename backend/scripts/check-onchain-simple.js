/**
 * Simple on-chain check - no TypeScript, no database
 * Usage: node backend/scripts/check-onchain-simple.js <vaultAddress> <proposalId> [vaultPda]
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getTransactionPda, getProposalPda, accounts } = require('@sqds/multisig');

const VAULT_ADDRESS = process.argv[2];
const PROPOSAL_ID = process.argv[3];
const VAULT_PDA = process.argv[4];

if (!VAULT_ADDRESS || !PROPOSAL_ID) {
  console.error('Usage: node backend/scripts/check-onchain-simple.js <vaultAddress> <proposalId> [vaultPda]');
  process.exit(1);
}

async function main() {
  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');
  const programId = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

  const multisigAddress = new PublicKey(VAULT_ADDRESS);
  const transactionIndex = BigInt(PROPOSAL_ID);

  // Get PDAs
  const [transactionPda] = getTransactionPda({
    multisigPda: multisigAddress,
    index: transactionIndex,
    programId,
  });

  const [proposalPda] = getProposalPda({
    multisigPda: multisigAddress,
    transactionIndex,
    programId,
  });

  console.log('\n📋 Match Details:');
  console.log({
    vaultAddress: VAULT_ADDRESS,
    vaultPda: VAULT_PDA || 'Not provided',
    proposalId: PROPOSAL_ID,
    transactionPda: transactionPda.toString(),
    proposalPda: proposalPda.toString(),
  });

  // Check if transaction account exists (should be closed if executed)
  const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
  
  if (!transactionAccount) {
    console.log('\n✅ Transaction account CLOSED - Proposal was EXECUTED!');
    console.log('✅ Funds should have been released');
    
    // Check vault balance
    if (VAULT_PDA) {
      const vaultBalance = await connection.getBalance(new PublicKey(VAULT_PDA), 'confirmed');
      console.log('\n💰 Final Vault Balance:');
      console.log({
        balanceSOL: (vaultBalance / 1e9).toFixed(6),
        balanceLamports: vaultBalance,
        note: 'Should be ~0.0025 SOL (rent-exempt reserve only) if executed',
      });
    }
    return;
  }

  // Decode transaction account
  try {
    const transaction = await accounts.VaultTransaction.fromAccountAddress(
      connection,
      transactionPda
    );

    const vaultTxStatus = transaction.status;
    const vaultTxApprovals = transaction.approvals || [];
    const vaultTxThreshold = transaction.threshold?.toNumber() || 2;

    console.log('\n📊 VaultTransaction Account:');
    console.log(JSON.stringify({
      status: vaultTxStatus,
      statusType: typeof vaultTxStatus,
      approvals: vaultTxApprovals.map((a) => a?.toString?.() || String(a)),
      approvalCount: vaultTxApprovals.length,
      threshold: vaultTxThreshold,
      hasEnoughSignatures: vaultTxApprovals.length >= vaultTxThreshold,
      isExecuteReady: vaultTxStatus === 1, // 1 = ExecuteReady
      note: 'Status: 0=Active, 1=ExecuteReady, 2=Executed',
    }, null, 2));
  } catch (error) {
    console.error('❌ Failed to decode VaultTransaction:', error.message);
  }

  // Check proposal account
  try {
    const proposal = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );

    const proposalStatusKind = proposal.status?.__kind;
    const proposalApproved = proposal.approved || [];
    const approvedCount = Array.isArray(proposalApproved) ? proposalApproved.length : 0;

    console.log('\n📊 Proposal Account:');
    console.log(JSON.stringify({
      statusKind: proposalStatusKind,
      approved: proposalApproved.map((s) => s?.toString?.() || String(s)),
      approvedCount,
      isExecuteReady: proposalStatusKind === 'ExecuteReady',
    }, null, 2));

    // Check if ExecuteReady
    const isExecuteReady = proposalStatusKind === 'ExecuteReady';
    console.log(`\n${isExecuteReady ? '✅' : '❌'} Proposal is ${isExecuteReady ? 'ExecuteReady' : 'NOT ExecuteReady'}`);
    
    if (!isExecuteReady) {
      console.log(`   Current status: ${proposalStatusKind}`);
    }
  } catch (error) {
    console.error('❌ Failed to decode Proposal:', error.message);
  }

  // Check vault balance
  if (VAULT_PDA) {
    const vaultBalance = await connection.getBalance(new PublicKey(VAULT_PDA), 'confirmed');
    console.log('\n💰 Vault Balance:');
    console.log(JSON.stringify({
      balanceSOL: (vaultBalance / 1e9).toFixed(6),
      balanceLamports: vaultBalance,
      note: 'Should be ~0.0025 SOL (rent-exempt reserve only) if executed',
    }, null, 2));
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});


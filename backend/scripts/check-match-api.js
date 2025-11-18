/**
 * Get match details from API and check on-chain
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getTransactionPda, getProposalPda, accounts } = require('@sqds/multisig');

const MATCH_ID = '09ac263a-db41-4a43-bd0b-4f7c6cea8bc5';
const API_URL = 'https://guess5.onrender.com';

async function fetchMatchDetails() {
  try {
    const response = await fetch(`${API_URL}/api/match/${MATCH_ID}/status`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch from API:', error.message);
    return null;
  }
}

async function checkOnChain(vaultAddress, proposalId, vaultPda) {
  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');
  const programId = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

  const multisigAddress = new PublicKey(vaultAddress);
  const transactionIndex = BigInt(proposalId);

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

  console.log('\n📍 Derived PDAs:');
  console.log({
    transactionPda: transactionPda.toString(),
    proposalPda: proposalPda.toString(),
  });

  // Check if transaction account exists
  const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
  
  if (!transactionAccount) {
    console.log('\n✅ Transaction account CLOSED - Proposal was EXECUTED!');
    if (vaultPda) {
      const vaultBalance = await connection.getBalance(new PublicKey(vaultPda), 'confirmed');
      console.log('\n💰 Final Vault Balance:');
      console.log({
        balanceSOL: (vaultBalance / 1e9).toFixed(6),
        balanceLamports: vaultBalance,
      });
    }
    return;
  }

  // Decode transaction account
  console.log('\n📊 VaultTransaction Account On-Chain:');
  try {
    const transaction = await accounts.VaultTransaction.fromAccountAddress(
      connection,
      transactionPda
    );

    const vaultTxStatus = transaction.status;
    const vaultTxApprovals = transaction.approvals || [];
    const vaultTxThreshold = transaction.threshold?.toNumber() || 2;

    const vaultTxInfo = {
      status: vaultTxStatus,
      statusMeaning: vaultTxStatus === 0 ? 'Active' : vaultTxStatus === 1 ? 'ExecuteReady' : vaultTxStatus === 2 ? 'Executed' : 'Unknown',
      approvals: vaultTxApprovals.map((a) => a?.toString?.() || String(a)),
      approvalCount: vaultTxApprovals.length,
      threshold: vaultTxThreshold,
      hasEnoughSignatures: vaultTxApprovals.length >= vaultTxThreshold,
      isExecuteReady: vaultTxStatus === 1,
    };
    console.log(JSON.stringify(vaultTxInfo, null, 2));
    
    if (vaultTxInfo.approvalCount < vaultTxInfo.threshold) {
      console.log(`\n⚠️  Vault transaction has only ${vaultTxInfo.approvalCount}/${vaultTxInfo.threshold} signatures`);
    } else if (vaultTxInfo.isExecuteReady) {
      console.log('\n✅ Vault transaction is ExecuteReady!');
    }
  } catch (error) {
    console.error('❌ Failed to decode VaultTransaction:', error.message);
  }

  // Check proposal account
  console.log('\n📊 Proposal Account On-Chain:');
  try {
    const proposal = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );

    const proposalStatusKind = proposal.status?.__kind;
    const proposalApproved = proposal.approved || [];
    const approvedCount = Array.isArray(proposalApproved) ? proposalApproved.length : 0;

    const proposalInfo = {
      statusKind: proposalStatusKind,
      approved: proposalApproved.map((s) => s?.toString?.() || String(s)),
      approvedCount,
      isExecuteReady: proposalStatusKind === 'ExecuteReady',
    };
    console.log(JSON.stringify(proposalInfo, null, 2));

    const isExecuteReady = proposalStatusKind === 'ExecuteReady';
    console.log(`\n${isExecuteReady ? '✅' : '❌'} Proposal is ${isExecuteReady ? 'ExecuteReady' : 'NOT ExecuteReady'}`);
  } catch (error) {
    console.error('❌ Failed to decode Proposal:', error.message);
  }

  // Check vault balance
  if (vaultPda) {
    const vaultBalance = await connection.getBalance(new PublicKey(vaultPda), 'confirmed');
    console.log('\n💰 Vault Balance:');
    console.log({
      balanceSOL: (vaultBalance / 1e9).toFixed(6),
      balanceLamports: vaultBalance,
    });
  }
}

async function main() {
  console.log(`\n🔍 Verifying Match: ${MATCH_ID}\n`);
  
  const matchData = await fetchMatchDetails();
  if (!matchData) {
    console.log('⚠️  Could not fetch from API, trying direct on-chain check...');
    console.log('Please provide: vaultAddress, proposalId, vaultPda');
    return;
  }

  console.log('📋 Match Details from API:');
  console.log(JSON.stringify({
    matchId: matchData.id || MATCH_ID,
    vaultAddress: matchData.squadsVaultAddress,
    vaultPda: matchData.squadsVaultPda,
    proposalId: matchData.payoutProposalId || matchData.tieRefundProposalId,
    proposalStatus: matchData.proposalStatus,
    needsSignatures: matchData.needsSignatures,
  }, null, 2));

  if (!matchData.squadsVaultAddress) {
    console.error('❌ No vault address in API response');
    return;
  }

  const proposalId = matchData.payoutProposalId || matchData.tieRefundProposalId;
  if (!proposalId) {
    console.error('❌ No proposal ID in API response');
    return;
  }

  await checkOnChain(
    matchData.squadsVaultAddress,
    proposalId,
    matchData.squadsVaultPda
  );
}

main().catch(console.error);


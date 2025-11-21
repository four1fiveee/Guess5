/**
 * Simple match check - bypasses TypeScript compilation issues
 * Usage: node backend/scripts/check-match-simple.js <matchId>
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getTransactionPda, getProposalPda, accounts } = require('@sqds/multisig');

const MATCH_ID = process.argv[2];

if (!MATCH_ID) {
  console.error('Usage: node backend/scripts/check-match-simple.js <matchId>');
  process.exit(1);
}

async function main() {
  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');

  // Get match data from database using require (bypasses TS compilation)
  const { AppDataSource } = require('../src/db/index');
  await AppDataSource.initialize();
  const { Match } = require('../src/models/Match');
  const matchRepository = AppDataSource.getRepository(Match);
  
  const match = await matchRepository.findOne({ where: { id: MATCH_ID } });
  
  if (!match) {
    console.error('❌ Match not found:', MATCH_ID);
    await AppDataSource.destroy();
    process.exit(1);
  }

  console.log('\n📋 Match Details:');
  console.log(JSON.stringify({
    matchId: match.id,
    vaultAddress: match.squadsVaultAddress,
    vaultPda: match.squadsVaultPda,
    proposalId: match.payoutProposalId || match.tieRefundProposalId,
    proposalStatus: match.proposalStatus,
    needsSignatures: match.needsSignatures,
    proposalSigners: match.proposalSigners,
    proposalExecutedAt: match.proposalExecutedAt,
    proposalTransactionId: match.proposalTransactionId,
  }, null, 2));

  if (!match.squadsVaultAddress) {
    console.error('❌ No vault address found');
    await AppDataSource.destroy();
    process.exit(1);
  }

  const proposalId = match.payoutProposalId || match.tieRefundProposalId;
  if (!proposalId) {
    console.error('❌ No proposal ID found');
    await AppDataSource.destroy();
    process.exit(1);
  }

  const multisigAddress = new PublicKey(match.squadsVaultAddress);
  const transactionIndex = BigInt(proposalId);
  const programId = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

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

  console.log('\n🔍 Checking Proposal State On-Chain:');
  console.log({
    transactionPda: transactionPda.toString(),
    proposalPda: proposalPda.toString(),
  });

  // Check if transaction account exists (should be closed if executed)
  const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
  
  if (!transactionAccount) {
    console.log('\n✅ Transaction account CLOSED - Proposal was EXECUTED!');
    console.log('✅ Funds should have been released');
    
    // Check vault balance
    if (match.squadsVaultPda) {
      const vaultBalance = await connection.getBalance(new PublicKey(match.squadsVaultPda), 'confirmed');
      console.log('\n💰 Final Vault Balance:');
      console.log({
        balanceSOL: (vaultBalance / 1e9).toFixed(6),
        balanceLamports: vaultBalance,
        note: 'Should be ~0.0025 SOL (rent-exempt reserve only) if executed',
      });
    }
    
    await AppDataSource.destroy();
    process.exit(0);
  }

  // Decode transaction account
  try {
    const transaction = await accounts.VaultTransaction.fromAccountAddress(
      connection,
      transactionPda
    );

    const vaultTxStatus = (transaction as any).status;
    const vaultTxApprovals = (transaction as any).approvals || [];
    const vaultTxThreshold = (transaction as any).threshold?.toNumber() || 2;

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

    const proposalStatusKind = (proposal as any).status?.__kind;
    const proposalApproved = (proposal as any).approved || [];
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
  if (match.squadsVaultPda) {
    const vaultBalance = await connection.getBalance(new PublicKey(match.squadsVaultPda), 'confirmed');
    console.log('\n💰 Vault Balance:');
    console.log(JSON.stringify({
      balanceSOL: (vaultBalance / 1e9).toFixed(6),
      balanceLamports: vaultBalance,
      note: 'Should be ~0.0025 SOL (rent-exempt reserve only) if executed',
    }, null, 2));
  }

  // Check player and fee wallet balances
  const playerWallet = match.player1 || match.player2;
  const feeWallet = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
  
  if (playerWallet) {
    const playerBalance = await connection.getBalance(new PublicKey(playerWallet), 'confirmed');
    console.log('\n👤 Player Wallet Balance:');
    console.log(JSON.stringify({
      wallet: playerWallet,
      balanceSOL: (playerBalance / 1e9).toFixed(6),
    }, null, 2));
  }
  
  const feeBalance = await connection.getBalance(new PublicKey(feeWallet), 'confirmed');
  console.log('\n💼 Fee Wallet Balance:');
  console.log(JSON.stringify({
    wallet: feeWallet,
    balanceSOL: (feeBalance / 1e9).toFixed(6),
  }, null, 2));

  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});



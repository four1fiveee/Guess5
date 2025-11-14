/**
 * Check match execution status - verify transaction signatures and proposal state
 * Run: npx ts-node backend/scripts/check-match-execution.ts <matchId>
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getTransactionPda, getProposalPda, accounts } from '@sqds/multisig';

const MATCH_ID = process.argv[2];

if (!MATCH_ID) {
  console.error('Usage: npx ts-node backend/scripts/check-match-execution.ts <matchId>');
  process.exit(1);
}

async function checkTransactionSignature(connection: Connection, signature: string) {
  try {
    const [tx, sigStatus] = await Promise.all([
      connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      }),
      connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true
      })
    ]);

    return {
      signature,
      found: !!tx,
      confirmed: sigStatus?.value?.[0]?.confirmationStatus === 'confirmed' || sigStatus?.value?.[0]?.confirmationStatus === 'finalized',
      err: sigStatus?.value?.[0]?.err || tx?.meta?.err,
      slot: sigStatus?.value?.[0]?.slot || tx?.slot,
      blockTime: tx?.blockTime,
      fee: tx?.meta?.fee,
      success: !sigStatus?.value?.[0]?.err && !tx?.meta?.err,
    };
  } catch (error: any) {
    return {
      signature,
      found: false,
      error: error.message,
    };
  }
}

async function main() {
  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');

  // Get match data from database
  try {
    const { AppDataSource } = require('../src/db');
    await AppDataSource.initialize();
    const { Match } = require('../src/models/Match');
    const matchRepository = AppDataSource.getRepository(Match);
  
  const match = await matchRepository.findOne({ where: { id: MATCH_ID } });
  
  if (!match) {
    console.error('❌ Match not found:', MATCH_ID);
    process.exit(1);
  }

  console.log('\n📋 Match Details:');
  console.log({
    matchId: match.id,
    vaultAddress: match.squadsVaultAddress,
    vaultPda: match.squadsVaultPda,
    proposalId: match.payoutProposalId || match.tieRefundProposalId,
    proposalStatus: match.proposalStatus,
    needsSignatures: match.needsSignatures,
    proposalSigners: match.proposalSigners,
    proposalExecutedAt: match.proposalExecutedAt,
    proposalTransactionId: match.proposalTransactionId,
  });

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

  // Get PDAs
  const [transactionPda] = getTransactionPda({
    multisigPda: multisigAddress,
    index: transactionIndex,
    programId: new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'),
  });

  const [proposalPda] = getProposalPda({
    multisigPda: multisigAddress,
    transactionIndex,
    programId: new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'),
  });

  console.log('\n🔍 Checking Proposal State On-Chain:');
  console.log({
    transactionPda: transactionPda.toString(),
    proposalPda: proposalPda.toString(),
  });

  // Check transaction account
  const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
  
  if (!transactionAccount) {
    console.log('✅ Transaction account not found - likely EXECUTED (accounts are closed after execution)');
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
    console.log({
      status: vaultTxStatus,
      statusType: typeof vaultTxStatus,
      approvals: vaultTxApprovals.map((a: any) => a?.toString?.() || String(a)),
      approvalCount: vaultTxApprovals.length,
      threshold: vaultTxThreshold,
      hasEnoughSignatures: vaultTxApprovals.length >= vaultTxThreshold,
      isExecuteReady: vaultTxStatus === 1, // 1 = ExecuteReady
    });
  } catch (error: any) {
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
    console.log({
      statusKind: proposalStatusKind,
      approved: proposalApproved.map((s: any) => s?.toString?.() || String(s)),
      approvedCount,
      isExecuteReady: proposalStatusKind === 'ExecuteReady',
    });

    // Check if ExecuteReady
    const isExecuteReady = proposalStatusKind === 'ExecuteReady';
    console.log(`\n${isExecuteReady ? '✅' : '❌'} Proposal is ${isExecuteReady ? 'ExecuteReady' : 'NOT ExecuteReady'}`);
    
    if (!isExecuteReady) {
      console.log(`   Current status: ${proposalStatusKind}`);
    }
  } catch (error: any) {
    console.error('❌ Failed to decode Proposal:', error.message);
  }

  // Check transaction signatures from logs if available
  const signaturesToCheck = [
    'jFrLbY4uQkaNLzFsArkepCGBLh9nSKJU4VtHhaPB4FB5989zqEubyF3DbeLoJzrKpzj9Wa55aZi26cpwWxrTwWS',
    '4NMgYkqVPqHLMU9xN6mKVCLMUFuRs8Nx4fxfceMTU5uKkp8rPXnmxXVYHaKU4qcxS6aRGL8qw2GPxXi5eWn414RM',
    '67BVG4uL8HvGtqeHmkpLswkixpL1vq8mRhxJKXWo9eGckaBNRMkHpr7dfrsqsG1hdQcAEmsfRNB87catui2YVKUn',
    '2q3YQCqsnBgW6VtabnkkXVxhH69xLfDf14MwzwN8PK7jCPfKEbxeUcjkg7qeeHBCJda7F5x3fgEg8vpJoGqs9QMf',
    '44hHbiyZgRNyA7RCHwQWMDC67wEnw5T2h1WT8hUR4u852ooyjdj9WBbiQ9XtDUKNBkQD1VYZSXYcWFLJUZ5GsTtQ',
    '3axECHtaAo9PTddAfEVv1RVFShH7rdccqZzqrPsZyyHEvwWG6Vdej8rXXeRHFW5rzesea2zCF6iqmo7GQHSXSUi5',
    '3JGWrekGFU3cPfoUbvrmPQi7RpdKL2dS287dSHzLsUEbPSBjaeumG6Kko8aLyHJfBncqCxZBkVvioifw1nYMqmeR',
  ];

  console.log('\n🔍 Checking Transaction Signatures:');
  for (const sig of signaturesToCheck) {
    const result = await checkTransactionSignature(connection, sig);
    console.log({
      signature: sig.substring(0, 20) + '...',
      found: result.found,
      confirmed: result.confirmed,
      success: result.success,
      err: result.err,
      slot: result.slot,
    });
  }

  // Check vault balance
  if (match.squadsVaultPda) {
    const vaultBalance = await connection.getBalance(new PublicKey(match.squadsVaultPda), 'confirmed');
    console.log('\n💰 Vault Balance:');
    console.log({
      balanceSOL: (vaultBalance / 1e9).toFixed(6),
      balanceLamports: vaultBalance,
    });
  }

    await AppDataSource.destroy();
  } catch (dbError: any) {
    console.error('❌ Database error:', dbError.message);
    throw dbError;
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});


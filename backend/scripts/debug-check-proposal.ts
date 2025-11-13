/**
 * Diagnostic script to check on-chain proposal state
 * Run: npx ts-node backend/scripts/debug-check-proposal.ts <matchId>
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getTransactionPda, getProposalPda } from '@sqds/multisig';
import * as accounts from '@sqds/multisig/lib/codegen/accounts';

const MATCH_ID = process.argv[2] || '36bedced-9090-4e74-aed3-2ad6cbca509d';

async function main() {
  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');

  // Get match data from database
  const { AppDataSource } = require('../src/db');
  await AppDataSource.initialize();
  const { Match } = require('../src/models/Match');
  const matchRepository = AppDataSource.getRepository(Match);
  
  const match = await matchRepository.findOne({ where: { id: MATCH_ID } });
  
  if (!match) {
    console.error('❌ Match not found:', MATCH_ID);
    process.exit(1);
  }

  console.log('📋 Match Details:');
  console.log({
    matchId: match.id,
    vaultAddress: match.squadsVaultAddress,
    vaultPda: match.squadsVaultPda,
    vaultDepositAddress: match.squadsVaultDepositAddress,
    proposalId: match.payoutProposalId || match.tieRefundProposalId,
    proposalStatus: match.proposalStatus,
    needsSignatures: match.needsSignatures,
    proposalSigners: match.proposalSigners,
    proposalExecutedAt: match.proposalExecutedAt,
    proposalTransactionId: match.proposalTransactionId,
  });

  if (!match.squadsVaultAddress) {
    console.error('❌ No vault address found');
    process.exit(1);
  }

  const proposalId = match.payoutProposalId || match.tieRefundProposalId;
  if (!proposalId) {
    console.error('❌ No proposal ID found');
    process.exit(1);
  }

  const multisigPda = new PublicKey(match.squadsVaultAddress);
  const transactionIndex = BigInt(proposalId);
  
  // Get program ID
  const { PROGRAM_ID } = require('@sqds/multisig');
  const programId = process.env.SQUADS_PROGRAM_ID 
    ? new PublicKey(process.env.SQUADS_PROGRAM_ID)
    : PROGRAM_ID;

  console.log('\n🔍 Checking on-chain proposal state...');
  console.log({
    multisigPda: multisigPda.toString(),
    transactionIndex: transactionIndex.toString(),
    programId: programId.toString(),
  });

  // 1) Vault deposit balance
  const vaultDeposit = match.squadsVaultDepositAddress 
    ? new PublicKey(match.squadsVaultDepositAddress)
    : match.squadsVaultPda
    ? new PublicKey(match.squadsVaultPda)
    : null;

  if (vaultDeposit) {
    const depositInfo = await connection.getAccountInfo(vaultDeposit, 'confirmed');
    console.log('\n💰 Vault deposit balance:');
    console.log({
      vaultDeposit: vaultDeposit.toString(),
      lamports: depositInfo?.lamports ?? 0,
      balanceSOL: (depositInfo?.lamports ?? 0) / 1e9,
    });
  }

  // 2) Recent signatures for vault deposit and multisig PDA
  if (vaultDeposit) {
    const vaultSigs = await connection.getSignaturesForAddress(vaultDeposit, { limit: 20 });
    console.log('\n📝 Recent signatures for vault deposit:');
    console.log(vaultSigs.map(s => ({ 
      signature: s.signature, 
      slot: s.slot,
      err: s.err,
      blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
    })));
  }

  const multisigSigs = await connection.getSignaturesForAddress(multisigPda, { limit: 20 });
  console.log('\n📝 Recent signatures for multisig PDA:');
  console.log(multisigSigs.map(s => ({ 
    signature: s.signature, 
    slot: s.slot,
    err: s.err,
    blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
  })));

  // 3) Fetch vaultTransaction account
  try {
    const [transactionPda] = getTransactionPda({
      multisigPda,
      index: transactionIndex,
      programId,
    });

    console.log('\n📍 Transaction PDA:', transactionPda.toString());

    const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
    
    if (!transactionAccount) {
      console.log('\n⚠️ Transaction account not found - likely executed (accounts are closed after execution)');
      console.log('This means execution likely succeeded!');
    } else {
      const vt = await accounts.VaultTransaction.fromAccountAddress(
        connection,
        transactionPda
      );

      const status = (vt as any).status;
      const approvals = (vt as any).approvals || [];
      const threshold = (vt as any).threshold?.toNumber() || 2;

      console.log('\n✅ Vault Transaction On-Chain State:');
      console.log({
        status: status,
        statusKind: status?.__kind || status,
        approvals: approvals.map((a: any) => a?.toString?.() || String(a)),
        approvalCount: approvals.length,
        threshold,
        hasEnoughSignatures: approvals.length >= threshold,
      });

      // Check if executed
      if (status?.__kind === 'Executed' || status === 'Executed') {
        console.log('\n✅ PROPOSAL IS EXECUTED ON-CHAIN!');
      } else if (status?.__kind === 'Approved' || status === 'Approved') {
        console.log('\n⚠️ Proposal is Approved but not Executed');
      } else if (status?.__kind === 'ExecuteReady' || status === 'ExecuteReady') {
        console.log('\n⚠️ Proposal is ExecuteReady but not Executed');
      } else {
        console.log('\n⚠️ Proposal status:', status);
      }
    }
  } catch (error: any) {
    console.error('❌ Error fetching vault transaction:', error.message);
  }

  // 4) Check for execute transactions
  console.log('\n🔍 Checking for execute transactions in recent multisig signatures...');
  for (const sig of multisigSigs.slice(0, 10)) {
    try {
      const tx = await connection.getTransaction(sig.signature, { commitment: 'confirmed' });
      if (tx && tx.meta) {
        const instructions = tx.transaction.message.instructions || [];
        const hasSquadsInstruction = instructions.some((ix: any) => {
          const programIdStr = ix.programId?.toString?.() || String(ix.programId);
          return programIdStr === programId.toString();
        });
        
        if (hasSquadsInstruction) {
          console.log('\n📋 Found Squads transaction:', {
            signature: sig.signature,
            slot: sig.slot,
            err: tx.meta.err,
            blockTime: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
          });
        }
      }
    } catch (err) {
      // Skip if transaction not found
    }
  }

  await AppDataSource.destroy();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


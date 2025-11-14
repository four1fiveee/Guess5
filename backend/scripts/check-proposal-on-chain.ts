/**
 * Diagnostic script to check on-chain proposal status and signatures
 * Run: npx ts-node backend/scripts/check-proposal-on-chain.ts <matchId>
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { SquadsClient, getTransactionPda, getProposalPda } from '@sqds/multisig';
import * as accounts from '@sqds/multisig/lib/codegen/accounts';

const MATCH_ID = process.argv[2] || 'b0d1a4ec-d1a2-4ddf-8252-c73bf8df463c';

async function checkProposalOnChain() {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

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
    proposalId: match.payoutProposalId || match.tieRefundProposalId,
    proposalStatus: match.proposalStatus,
    needsSignatures: match.needsSignatures,
    proposalSigners: match.proposalSigners,
    player1: match.player1,
    player2: match.player2,
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

  try {
    // Get transaction PDA
    const [transactionPda] = getTransactionPda({
      multisigPda,
      index: transactionIndex,
      programId,
    });

    console.log('\n📍 Transaction PDA:', transactionPda.toString());

    // Fetch vault transaction account
    const vaultTx = await accounts.VaultTransaction.fromAccountAddress(
      connection,
      transactionPda,
      'confirmed'
    );

    const status = (vaultTx as any).status;
    const approvals = (vaultTx as any).approvals || [];
    const threshold = (vaultTx as any).threshold?.toNumber() || 2;

    console.log('\n✅ Vault Transaction On-Chain State:');
    console.log({
      status: status,
      statusType: typeof status,
      approvals: approvals.map((a: any) => a?.toString?.() || String(a)),
      approvalCount: approvals.length,
      threshold,
      hasEnoughSignatures: approvals.length >= threshold,
    });

    // Get proposal PDA
    const [proposalPda] = getProposalPda({
      multisigPda,
      transactionIndex,
      programId,
    });

    console.log('\n📍 Proposal PDA:', proposalPda.toString());

    // Fetch proposal account
    const proposal = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda,
      'confirmed'
    );

    const proposalStatus = (proposal as any).status;
    const proposalApprovals = (proposal as any).approved || [];

    console.log('\n✅ Proposal On-Chain State:');
    console.log({
      status: proposalStatus,
      statusKind: proposalStatus?.__kind,
      approved: proposalApprovals.map((a: any) => a?.toString?.() || String(a)),
      approvedCount: proposalApprovals.length,
    });

    // Check vault balance
    if (match.squadsVaultPda) {
      const vaultPda = new PublicKey(match.squadsVaultPda);
      const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const vaultAccountInfo = await connection.getAccountInfo(vaultPda, 'confirmed');
      
      console.log('\n💰 Vault Balance:');
      console.log({
        vaultPda: vaultPda.toString(),
        balanceLamports: vaultBalance,
        balanceSOL: vaultBalance / 1e9,
        accountExists: !!vaultAccountInfo,
        owner: vaultAccountInfo?.owner.toString(),
      });
    }

    // Check vault deposit address balance
    if (match.squadsVaultDepositAddress) {
      const depositAddr = new PublicKey(match.squadsVaultDepositAddress);
      const depositBalance = await connection.getBalance(depositAddr, 'confirmed');
      
      console.log('\n💰 Vault Deposit Address Balance:');
      console.log({
        depositAddress: depositAddr.toString(),
        balanceLamports: depositBalance,
        balanceSOL: depositBalance / 1e9,
      });
    }

    // Compare with database
    console.log('\n📊 Comparison:');
    const dbSigners = JSON.parse(match.proposalSigners || '[]');
    const onChainSigners = approvals.map((a: any) => a?.toString?.() || String(a));
    
    console.log({
      databaseSigners: dbSigners,
      onChainSigners,
      databaseNeedsSignatures: match.needsSignatures,
      calculatedNeedsSignatures: Math.max(0, threshold - onChainSigners.length),
      databaseStatus: match.proposalStatus,
      onChainStatus: status,
      match: dbSigners.length === onChainSigners.length && 
             dbSigners.every((s: string) => onChainSigners.includes(s)),
    });

    // Diagnosis
    console.log('\n🔬 Diagnosis:');
    if (onChainSigners.length < threshold) {
      console.log('❌ NOT ENOUGH SIGNATURES ON-CHAIN');
      console.log(`   Need ${threshold} signatures, have ${onChainSigners.length}`);
      console.log(`   Missing: ${threshold - onChainSigners.length} signature(s)`);
      
      if (onChainSigners.length === 1) {
        console.log('   → Only 1 player signed. Fee wallet auto-approval may have failed.');
      }
    } else {
      console.log('✅ ENOUGH SIGNATURES ON-CHAIN');
      console.log(`   Have ${onChainSigners.length} signatures, need ${threshold}`);
      console.log('   → Execution should have triggered. Check backend logs for execution attempts.');
    }

  } catch (error: any) {
    console.error('❌ Error checking on-chain state:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  await AppDataSource.destroy();
}

checkProposalOnChain().catch(console.error);





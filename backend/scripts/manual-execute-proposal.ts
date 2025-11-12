/**
 * Manual script to execute a Squads proposal that is READY_TO_EXECUTE
 * Usage: npx ts-node scripts/manual-execute-proposal.ts <matchId>
 */

// @ts-nocheck
const { AppDataSource } = require('../src/db/index');
const { Match } = require('../src/models/Match');
const { getSquadsVaultService } = require('../src/services/squadsVaultService');
const { getFeeWalletKeypair } = require('../src/config/wallet');

async function manualExecuteProposal(matchId: string) {
  try {
    console.log('🔧 Initializing database connection...');
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }

    console.log('📋 Match found:', {
      matchId: match.id,
      proposalStatus: match.proposalStatus,
      needsSignatures: match.needsSignatures,
      payoutProposalId: match.payoutProposalId,
      tieRefundProposalId: match.tieRefundProposalId,
      squadsVaultAddress: match.squadsVaultAddress,
      squadsVaultPda: match.squadsVaultPda,
    });

    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    if (!proposalId) {
      console.error('❌ No proposal ID found for this match');
      process.exit(1);
    }

    const proposalIdString = String(proposalId).trim();
    const proposalStatus = (match.proposalStatus || '').toUpperCase();

    if (proposalStatus === 'EXECUTED') {
      console.log('✅ Proposal already executed');
      console.log('Execution signature:', match.proposalTransactionId || match.refundTxHash || match.payoutTxHash);
      process.exit(0);
    }

    if (proposalStatus !== 'READY_TO_EXECUTE' && match.needsSignatures !== 0) {
      console.error('❌ Proposal is not ready to execute:', {
        proposalStatus,
        needsSignatures: match.needsSignatures,
      });
      process.exit(1);
    }

    if (!match.squadsVaultAddress) {
      console.error('❌ No vault address found for this match');
      process.exit(1);
    }

    console.log('🔑 Getting fee wallet keypair...');
    const feeWalletKeypair = getFeeWalletKeypair();
    console.log('✅ Fee wallet keypair obtained:', feeWalletKeypair.publicKey.toString());

    console.log('🚀 Executing proposal...');
    const squadsVaultService = getSquadsVaultService();
    const executeResult = await squadsVaultService.executeProposal(
      match.squadsVaultAddress,
      proposalIdString,
      feeWalletKeypair,
      match.squadsVaultPda ?? undefined
    );

    if (!executeResult.success) {
      console.error('❌ Execution failed:', {
        error: executeResult.error,
        logs: executeResult.logs?.slice(-10),
      });
      process.exit(1);
    }

    console.log('✅ Proposal executed successfully!', {
      signature: executeResult.signature,
      slot: executeResult.slot,
      executedAt: executeResult.executedAt,
    });

    // Update database
    const isTieRefund = !!match.tieRefundProposalId && String(match.tieRefundProposalId).trim() === proposalIdString;
    const isWinnerPayout = !!match.payoutProposalId && String(match.payoutProposalId).trim() === proposalIdString && match.winner && match.winner !== 'tie';

    const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();

    if (isTieRefund) {
      await matchRepository.update(matchId, {
        proposalStatus: 'EXECUTED',
        proposalExecutedAt: executedAt,
        refundTxHash: executeResult.signature ?? null,
        proposalTransactionId: executeResult.signature ?? null,
      });
      console.log('✅ Database updated with tie refund execution');
    } else if (isWinnerPayout) {
      await matchRepository.update(matchId, {
        proposalStatus: 'EXECUTED',
        proposalExecutedAt: executedAt,
        payoutTxHash: executeResult.signature ?? null,
        proposalTransactionId: executeResult.signature ?? null,
      });
      console.log('✅ Database updated with winner payout execution');
    } else {
      await matchRepository.update(matchId, {
        proposalStatus: 'EXECUTED',
        proposalExecutedAt: executedAt,
        proposalTransactionId: executeResult.signature ?? null,
      });
      console.log('✅ Database updated with execution');
    }

    console.log('\n🎉 Manual execution completed successfully!');
    console.log('Transaction signature:', executeResult.signature);
    console.log('View on Solana Explorer:', `https://explorer.solana.com/tx/${executeResult.signature}?cluster=devnet`);

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during manual execution:', error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('❌ Usage: npx ts-node scripts/manual-execute-proposal.ts <matchId>');
  process.exit(1);
}

manualExecuteProposal(matchId);


import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPremiumSolanaConnection } from '../config/solanaConnection';
import { Not } from 'typeorm';

/**
 * Investigate the most recent refund transaction
 * This script finds the most recent cancelled match with a refund
 * and analyzes the transaction on-chain
 */
async function investigateRefund() {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const matchRepository = AppDataSource.getRepository(Match);

    // Find the most recent match that was refunded
    const { Not, IsNull } = require('typeorm');
    const refundedMatch = await matchRepository.findOne({
      where: [
        { escrowStatus: 'REFUNDED' },
        { refundTxHash: Not(IsNull()) }
      ],
      order: { updatedAt: 'DESC' },
    });

    if (!refundedMatch) {
      console.log('❌ No refunded matches found in database');
      return;
    }

    console.log('\n🔍 REFUND INVESTIGATION');
    console.log('='.repeat(60));
    console.log(`Match ID: ${refundedMatch.id}`);
    console.log(`Status: ${refundedMatch.status}`);
    console.log(`Escrow Status: ${refundedMatch.escrowStatus}`);
    console.log(`Refund Tx Hash: ${refundedMatch.refundTxHash}`);
    console.log(`Player 1: ${refundedMatch.player1}`);
    console.log(`Player 2: ${refundedMatch.player2}`);
    console.log(`Player 1 Paid: ${refundedMatch.player1Paid}`);
    console.log(`Player 2 Paid: ${refundedMatch.player2Paid}`);
    console.log(`Entry Fee: ${refundedMatch.entryFee} SOL`);
    console.log(`Created At: ${refundedMatch.createdAt}`);
    console.log(`Updated At: ${refundedMatch.updatedAt}`);

    if (!refundedMatch.refundTxHash) {
      console.log('\n⚠️ No refund transaction hash found in database');
      return;
    }

    // Connect to Solana
    const connection = createPremiumSolanaConnection();
    const transactionSignature = refundedMatch.refundTxHash;

    console.log('\n📊 ANALYZING TRANSACTION ON-CHAIN');
    console.log('='.repeat(60));
    console.log(`Transaction: ${transactionSignature}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`);

    // Fetch transaction details
    const transaction = await connection.getTransaction(transactionSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!transaction) {
      console.log('\n❌ Transaction not found on-chain');
      return;
    }

    if (transaction.meta?.err) {
      console.log(`\n❌ Transaction failed: ${JSON.stringify(transaction.meta.err)}`);
      return;
    }

    console.log('\n✅ Transaction found and successful');

    // Analyze account balance changes
    const accountKeys = transaction.transaction.message.accountKeys.map(key => 
      typeof key === 'string' ? key : key.toString()
    );
    const preBalances = transaction.meta?.preBalances || [];
    const postBalances = transaction.meta?.postBalances || [];

    console.log('\n💰 BALANCE CHANGES');
    console.log('='.repeat(60));

    // Find which player was refunded
    const player1Pubkey = refundedMatch.player1;
    const player2Pubkey = refundedMatch.player2;
    const payerPubkey = refundedMatch.player1Paid ? player1Pubkey : player2Pubkey;

    let payerIndex = -1;
    let payerBalanceChange = 0;
    let escrowIndex = -1;
    let escrowBalanceChange = 0;

    for (let i = 0; i < accountKeys.length; i++) {
      const account = accountKeys[i];
      const preBalance = preBalances[i] || 0;
      const postBalance = postBalances[i] || 0;
      const balanceChange = postBalance - preBalance;

      if (account === payerPubkey) {
        payerIndex = i;
        payerBalanceChange = balanceChange;
        console.log(`\n👤 Payer (${payerPubkey.substring(0, 8)}...):`);
        console.log(`   Pre-balance:  ${(preBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`   Post-balance: ${(postBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`   Change:       ${(balanceChange / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      }

      // Try to find escrow account (PDA)
      // Escrow PDA is derived from match ID
      if (balanceChange < 0 && Math.abs(balanceChange) > 1000000) {
        // Likely the escrow account (decreased balance)
        escrowIndex = i;
        escrowBalanceChange = balanceChange;
        console.log(`\n🏦 Escrow Account (${account.substring(0, 8)}...):`);
        console.log(`   Pre-balance:  ${(preBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`   Post-balance: ${(postBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
        console.log(`   Change:       ${(balanceChange / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      }
    }

    // Calculate expected refund
    const entryFeeLamports = Math.floor((refundedMatch.entryFee || 0) * LAMPORTS_PER_SOL);
    const expectedRefundSOL = refundedMatch.entryFee || 0;

    console.log('\n📋 REFUND ANALYSIS');
    console.log('='.repeat(60));
    console.log(`Expected Refund: ${expectedRefundSOL.toFixed(9)} SOL (${entryFeeLamports} lamports)`);
    console.log(`Actual Refund:   ${(payerBalanceChange / LAMPORTS_PER_SOL).toFixed(9)} SOL (${payerBalanceChange} lamports)`);

    const difference = payerBalanceChange - entryFeeLamports;
    if (Math.abs(difference) < 1000) {
      // Within 1000 lamports (0.000001 SOL) is considered correct
      console.log(`✅ Refund amount matches expected (difference: ${difference} lamports)`);
    } else {
      console.log(`⚠️ Refund amount differs from expected by ${difference} lamports (${(difference / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);
    }

    // Check for other transactions around the same time
    console.log('\n🔍 CHECKING FOR OTHER TRANSACTIONS');
    console.log('='.repeat(60));
    
    const transactionSlot = transaction.slot;
    const payerAccount = new PublicKey(payerPubkey);
    
    // Get recent transactions for the payer
    const signatures = await connection.getSignaturesForAddress(payerAccount, {
      limit: 10,
    });

    console.log(`\nRecent transactions for payer (${payerPubkey.substring(0, 8)}...):`);
    const refundTime = transaction.blockTime ? new Date(transaction.blockTime * 1000) : null;
    
    for (const sig of signatures) {
      const sigTime = sig.blockTime ? new Date(sig.blockTime * 1000) : null;
      const timeDiff = refundTime && sigTime ? Math.abs(sigTime.getTime() - refundTime.getTime()) / 1000 : null;
      
      if (sig.signature === transactionSignature) {
        console.log(`  ✅ ${sig.signature.substring(0, 16)}... (REFUND - ${refundTime?.toISOString()})`);
      } else if (timeDiff && timeDiff < 60) {
        // Within 60 seconds
        console.log(`  ⚠️  ${sig.signature.substring(0, 16)}... (${timeDiff.toFixed(0)}s ${timeDiff < 0 ? 'before' : 'after'} refund - ${sigTime?.toISOString()})`);
        console.log(`     Explorer: https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`);
      }
    }

    // Check transaction instructions
    console.log('\n📝 TRANSACTION INSTRUCTIONS');
    console.log('='.repeat(60));
    const instructions = transaction.transaction.message.instructions || [];
    console.log(`Number of instructions: ${instructions.length}`);
    
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      if ('programId' in ix) {
        const programId = typeof ix.programId === 'string' ? ix.programId : ix.programId.toString();
        console.log(`  Instruction ${i + 1}: Program ${programId.substring(0, 8)}...`);
      }
    }

    // Summary
    console.log('\n📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Match ID: ${refundedMatch.id}`);
    console.log(`Refund Transaction: ${transactionSignature}`);
    console.log(`Expected Refund: ${expectedRefundSOL.toFixed(9)} SOL`);
    console.log(`Actual Refund: ${(payerBalanceChange / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`Difference: ${(difference / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`Explorer Link: https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`);

    if (Math.abs(difference) > 1000) {
      console.log('\n⚠️ WARNING: Refund amount differs significantly from expected!');
      console.log('   This could indicate:');
      console.log('   1. Rent was refunded (escrow account closed)');
      console.log('   2. Multiple transactions occurred');
      console.log('   3. Transaction fee was refunded (unlikely)');
      console.log('   4. Bonus payment was made (check other transactions)');
    } else {
      console.log('\n✅ Refund amount is correct');
    }

  } catch (error) {
    console.error('❌ Error investigating refund:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

// Run the investigation
investigateRefund()
  .then(() => {
    console.log('\n✅ Investigation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Investigation failed:', error);
    process.exit(1);
  });


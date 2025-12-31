/**
 * Investigate specific match and transactions
 */
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPremiumSolanaConnection } from '../config/solanaConnection';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const MATCH_ID = 'b7100f9b-5722-46dd-97ff-fec04b01904f';
const WALLET_TO_CHECK = '4FwkzLV9ayU3B7ZWXR7fo6TtC6ievfYEgobscwrcc5Rs';
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

async function investigateMatch() {
  try {
    console.log('🔍 Investigating match:', MATCH_ID);
    console.log('='.repeat(60));
    
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: MATCH_ID } });

    if (!match) {
      console.log('❌ Match not found in database');
      return;
    }

    console.log('\n📊 MATCH DATA:');
    console.log('='.repeat(60));
    console.log(`Match ID: ${match.id}`);
    console.log(`Status: ${match.status}`);
    console.log(`Escrow Status: ${match.escrowStatus}`);
    console.log(`Player 1: ${match.player1}`);
    console.log(`Player 2: ${match.player2}`);
    console.log(`Player 1 Paid: ${match.player1Paid}`);
    console.log(`Player 2 Paid: ${match.player2Paid}`);
    console.log(`Entry Fee: ${match.entryFee} SOL`);
    console.log(`Escrow Address: ${(match as any).escrowAddress || 'N/A'}`);
    console.log(`Escrow PDA: ${(match as any).escrowPda || 'N/A'}`);
    console.log(`Winner: ${match.winner || 'N/A'}`);
    console.log(`Is Completed: ${match.isCompleted}`);
    console.log(`Proposal Status: ${(match as any).proposalStatus || 'N/A'}`);
    console.log(`Proposal Executed At: ${(match as any).proposalExecutedAt || 'N/A'}`);
    console.log(`Payout Tx Signature: ${(match as any).payoutTxSignature || 'N/A'}`);
    console.log(`Refund Tx Hash: ${match.refundTxHash || 'N/A'}`);
    console.log(`Created At: ${match.createdAt}`);
    console.log(`Updated At: ${match.updatedAt}`);

    // Check wallet transactions
    console.log('\n💰 CHECKING WALLET TRANSACTIONS:');
    console.log('='.repeat(60));
    const connection = createPremiumSolanaConnection();
    const walletPubkey = new PublicKey(WALLET_TO_CHECK);
    const feeWalletPubkey = new PublicKey(FEE_WALLET);

    console.log(`\nChecking transactions for: ${WALLET_TO_CHECK}`);
    const walletSigs = await connection.getSignaturesForAddress(walletPubkey, { limit: 20 });
    
    console.log(`\nFound ${walletSigs.length} recent transactions:`);
    for (const sig of walletSigs) {
      const tx = await connection.getTransaction(sig.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (tx && tx.meta && !tx.meta.err) {
        const accountKeys = tx.transaction.message.accountKeys.map((k: any) => 
          typeof k === 'string' ? k : k.toString()
        );
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];
        
        const walletIndex = accountKeys.findIndex((k: string) => k === WALLET_TO_CHECK);
        const feeWalletIndex = accountKeys.findIndex((k: string) => k === FEE_WALLET);
        
        if (walletIndex >= 0) {
          const balanceChange = (postBalances[walletIndex] - preBalances[walletIndex]) / LAMPORTS_PER_SOL;
          const isFromFeeWallet = feeWalletIndex >= 0 && 
            preBalances[feeWalletIndex] > postBalances[feeWalletIndex];
          
          if (Math.abs(balanceChange) > 0.0001) {
            console.log(`\n  ${sig.signature.substring(0, 16)}...`);
            console.log(`    Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
            console.log(`    Balance Change: ${balanceChange > 0 ? '+' : ''}${balanceChange.toFixed(6)} SOL`);
            if (isFromFeeWallet) {
              console.log(`    ⚠️ FROM FEE WALLET (2Q9W...tvjt)`);
            }
            console.log(`    Explorer: https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`);
          }
        }
      }
    }

    // Check fee wallet transactions to this wallet
    console.log(`\n\nChecking fee wallet transactions to ${WALLET_TO_CHECK.substring(0, 8)}...`);
    const feeWalletSigs = await connection.getSignaturesForAddress(feeWalletPubkey, { limit: 20 });
    
    let transfersToWallet = 0;
    for (const sig of feeWalletSigs) {
      const tx = await connection.getTransaction(sig.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (tx && tx.meta && !tx.meta.err) {
        const accountKeys = tx.transaction.message.accountKeys.map((k: any) => 
          typeof k === 'string' ? k : k.toString()
        );
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];
        
        const walletIndex = accountKeys.findIndex((k: string) => k === WALLET_TO_CHECK);
        const feeWalletIndex = accountKeys.findIndex((k: string) => k === FEE_WALLET);
        
        if (walletIndex >= 0 && feeWalletIndex >= 0) {
          const walletBalanceChange = (postBalances[walletIndex] - preBalances[walletIndex]) / LAMPORTS_PER_SOL;
          const feeWalletBalanceChange = (postBalances[feeWalletIndex] - preBalances[feeWalletIndex]) / LAMPORTS_PER_SOL;
          
          if (walletBalanceChange > 0 && feeWalletBalanceChange < 0) {
            transfersToWallet++;
            console.log(`\n  ⚠️ FEE WALLET TRANSFER #${transfersToWallet}:`);
            console.log(`    Signature: ${sig.signature}`);
            console.log(`    Amount: ${walletBalanceChange.toFixed(6)} SOL`);
            console.log(`    Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
            console.log(`    Explorer: https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`);
          }
        }
      }
    }

    console.log(`\n\n📋 SUMMARY:`);
    console.log('='.repeat(60));
    console.log(`Match Status: ${match.status}`);
    console.log(`Escrow Status: ${match.escrowStatus}`);
    console.log(`Is Completed: ${match.isCompleted}`);
    console.log(`Proposal Executed: ${!!(match as any).proposalExecutedAt}`);
    console.log(`Fee Wallet Transfers to ${WALLET_TO_CHECK.substring(0, 8)}...: ${transfersToWallet}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

investigateMatch()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Investigation failed:', error);
    process.exit(1);
  });


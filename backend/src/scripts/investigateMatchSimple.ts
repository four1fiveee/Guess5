/**
 * Simple match investigation using existing database setup
 */
import 'reflect-metadata';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';

const MATCH_ID = 'b7100f9b-5722-46dd-97ff-fec04b01904f';
const WALLET = '4FwkzLV9ayU3B7ZWXR7fo6TtC6ievfYEgobscwrcc5Rs';
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

async function investigate() {
  const output: string[] = [];
  
  function log(msg: string) {
    const line = msg;
    output.push(line);
    console.log(line);
  }
  
  try {
    log('🔍 INVESTIGATING MATCH: ' + MATCH_ID);
    log('='.repeat(80));
    
    // Initialize database
    if (!AppDataSource.isInitialized) {
      log('📡 Connecting to database...');
      await AppDataSource.initialize();
      log('✅ Database connected');
    }
    
    // Query match
    const matchRepository = AppDataSource.getRepository(Match);
    log('📊 Querying match from database...');
    const match = await matchRepository.findOne({ where: { id: MATCH_ID } });
    
    if (!match) {
      log('❌ Match not found in database');
      await AppDataSource.destroy();
      return;
    }
    
    log('\n📊 MATCH DATA:');
    log('   ID: ' + match.id);
    log('   Status: ' + match.status);
    log('   Escrow Status: ' + (match.escrowStatus || 'N/A'));
    log('   Player 1: ' + match.player1);
    log('   Player 2: ' + (match.player2 || 'N/A'));
    log('   Player 1 Paid: ' + match.player1Paid);
    log('   Player 2 Paid: ' + match.player2Paid);
    log('   Entry Fee: ' + match.entryFee + ' SOL');
    log('   Winner: ' + (match.winner || 'N/A'));
    log('   Is Completed: ' + match.isCompleted);
    log('   Escrow Address: ' + ((match as any).escrowAddress || 'N/A'));
    log('   Refund Tx Hash: ' + (match.refundTxHash || 'N/A'));
    log('   Payout Tx Signature: ' + ((match as any).payoutTxSignature || 'N/A'));
    log('   Created At: ' + match.createdAt);
    log('   Updated At: ' + match.updatedAt);
    
    // Check Solana
    log('\n💰 CHECKING SOLANA TRANSACTIONS:');
    log('='.repeat(80));
    
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const walletPubkey = new PublicKey(WALLET);
    log('\nChecking transactions for wallet: ' + WALLET);
    const walletSigs = await connection.getSignaturesForAddress(walletPubkey, { limit: 20 });
    log('Found ' + walletSigs.length + ' transactions\n');
    
    let feeWalletTransfers = 0;
    for (const sig of walletSigs.slice(0, 10)) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (tx && tx.meta && !tx.meta.err) {
          const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k: any) => k.toString());
          const preBalances = tx.meta.preBalances || [];
          const postBalances = tx.meta.postBalances || [];
          
          const walletIndex = accountKeys.findIndex((k: string) => k === WALLET);
          const feeWalletIndex = accountKeys.findIndex((k: string) => k === FEE_WALLET);
          
          if (walletIndex >= 0) {
            const balanceChange = (postBalances[walletIndex] - preBalances[walletIndex]) / LAMPORTS_PER_SOL;
            
            if (Math.abs(balanceChange) > 0.0001) {
              const isFromFeeWallet = feeWalletIndex >= 0 && preBalances[feeWalletIndex] > postBalances[feeWalletIndex];
              
              log('  Transaction: ' + sig.signature.substring(0, 32) + '...');
              log('    Time: ' + (sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'));
              log('    Balance Change: ' + (balanceChange > 0 ? '+' : '') + balanceChange.toFixed(6) + ' SOL');
              
              if (isFromFeeWallet) {
                feeWalletTransfers++;
                log('    ⚠️⚠️⚠️ FROM FEE WALLET ⚠️⚠️⚠️');
              }
              
              log('    Explorer: https://explorer.solana.com/tx/' + sig.signature + '?cluster=devnet');
              log('');
            }
          }
        }
      } catch (err: any) {
        // Skip errors
      }
    }
    
    log('\n📋 SUMMARY:');
    log('='.repeat(80));
    log('Match Status: ' + match.status);
    log('Is Completed: ' + match.isCompleted);
    log('Has Winner: ' + (!!match.winner && match.winner !== 'tie'));
    log('Escrow Address: ' + ((match as any).escrowAddress || 'NONE'));
    log('Refund Tx Hash: ' + (match.refundTxHash || 'NONE'));
    log('Payout Tx Signature: ' + ((match as any).payoutTxSignature || 'NONE'));
    log('⚠️ Fee Wallet Transfers: ' + feeWalletTransfers);
    
    if (feeWalletTransfers > 0 && match.isCompleted && match.winner && match.winner !== 'tie') {
      log('\n❌ CRITICAL ISSUE DETECTED:');
      log('   A completed match with a winner received refunds from the fee wallet!');
      log('   This should NOT happen - completed matches should be settled via escrow.');
    }
    
    // Write to file
    fs.writeFileSync('investigation_result.txt', output.join('\n'));
    log('\n✅ Results written to investigation_result.txt');
    
    await AppDataSource.destroy();
    
  } catch (error: any) {
    log('❌ Error: ' + error.message);
    if (error.stack) log(error.stack);
    fs.writeFileSync('investigation_result.txt', output.join('\n'));
  }
}

investigate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });


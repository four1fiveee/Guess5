/**
 * Direct investigation of match - simpler version
 */
import * as dotenv from 'dotenv';
dotenv.config();

const MATCH_ID = 'b7100f9b-5722-46dd-97ff-fec04b01904f';
const WALLET = '4FwkzLV9ayU3B7ZWXR7fo6TtC6ievfYEgobscwrcc5Rs';
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

async function investigate() {
  process.stdout.write('🔍 INVESTIGATING MATCH: ' + MATCH_ID + '\n');
  process.stdout.write('='.repeat(80) + '\n');
  process.stdout.flush();
  
  try {
    // Connect to database
    const { Client } = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL || 'postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require'
    });
    
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Query match
    const matchResult = await client.query('SELECT * FROM "match" WHERE id = $1', [MATCH_ID]);
    
    if (matchResult.rows.length === 0) {
      console.log('❌ Match not found');
      await client.end();
      return;
    }
    
    const match = matchResult.rows[0];
    console.log('📊 MATCH DATA:');
    console.log('   ID:', match.id);
    console.log('   Status:', match.status);
    console.log('   Escrow Status:', match.escrowStatus);
    console.log('   Player 1:', match.player1);
    console.log('   Player 2:', match.player2);
    console.log('   Player 1 Paid:', match.player1Paid);
    console.log('   Player 2 Paid:', match.player2Paid);
    console.log('   Entry Fee:', match.entryFee, 'SOL');
    console.log('   Winner:', match.winner || 'N/A');
    console.log('   Is Completed:', match.isCompleted);
    console.log('   Escrow Address:', match.escrowAddress || 'N/A');
    console.log('   Refund Tx Hash:', match.refundTxHash || 'N/A');
    console.log('   Payout Tx Signature:', match.payoutTxSignature || 'N/A');
    console.log('   Created At:', match.createdAt);
    console.log('   Updated At:', match.updatedAt);
    console.log('');
    
    // Check Solana transactions
    console.log('💰 CHECKING SOLANA TRANSACTIONS:');
    console.log('='.repeat(80));
    
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const walletPubkey = new PublicKey(WALLET);
    const feeWalletPubkey = new PublicKey(FEE_WALLET);
    
    console.log(`\nChecking transactions for wallet: ${WALLET}`);
    const walletSigs = await connection.getSignaturesForAddress(walletPubkey, { limit: 20 });
    console.log(`Found ${walletSigs.length} transactions\n`);
    
    let feeWalletTransfers = 0;
    for (const sig of walletSigs) {
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
              
              console.log(`  Transaction: ${sig.signature.substring(0, 16)}...`);
              console.log(`    Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
              console.log(`    Balance Change: ${balanceChange > 0 ? '+' : ''}${balanceChange.toFixed(6)} SOL`);
              
              if (isFromFeeWallet) {
                feeWalletTransfers++;
                console.log(`    ⚠️⚠️⚠️ FROM FEE WALLET (${FEE_WALLET.substring(0, 8)}...) ⚠️⚠️⚠️`);
              }
              
              console.log(`    Explorer: https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`);
              console.log('');
            }
          }
        }
      } catch (err) {
        // Skip failed transaction fetches
      }
    }
    
    console.log('\n📋 SUMMARY:');
    console.log('='.repeat(80));
    console.log(`Match Status: ${match.status}`);
    console.log(`Is Completed: ${match.isCompleted}`);
    console.log(`Has Winner: ${!!match.winner && match.winner !== 'tie'}`);
    console.log(`Escrow Address: ${match.escrowAddress || 'NONE'}`);
    console.log(`Refund Tx Hash: ${match.refundTxHash || 'NONE'}`);
    console.log(`Payout Tx Signature: ${match.payoutTxSignature || 'NONE'}`);
    console.log(`⚠️ Fee Wallet Transfers: ${feeWalletTransfers}`);
    
    if (feeWalletTransfers > 0 && match.isCompleted && match.winner && match.winner !== 'tie') {
      console.log('\n❌ CRITICAL ISSUE DETECTED:');
      console.log('   A completed match with a winner received refunds from the fee wallet!');
      console.log('   This should NOT happen - completed matches should be settled via escrow.');
    }
    
    await client.end();
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

investigate()
  .then(() => {
    console.log('\n✅ Investigation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Investigation failed:', error);
    process.exit(1);
  });


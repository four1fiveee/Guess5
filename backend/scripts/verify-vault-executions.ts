/**
 * Verify if proposals have actually been executed on-chain
 * This checks the Solana blockchain directly to see if funds left the vault
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { getVaultPda } from '@sqds/multisig';

const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

async function verifyVaultExecution(matchId: string, vaultAddress: string, vaultPda: string) {
  try {
    const vaultPdaPubkey = new PublicKey(vaultPda);
    const vaultBalance = await connection.getBalance(vaultPdaPubkey, 'confirmed');
    
    console.log(`\n🔍 Match: ${matchId}`);
    console.log(`   Vault PDA: ${vaultPda}`);
    console.log(`   Current Balance: ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    // Get transaction history for the vault PDA
    // Note: This is a simplified check - in production you'd want to check the actual proposal execution
    const signatures = await connection.getSignaturesForAddress(vaultPdaPubkey, { limit: 10 });
    
    console.log(`   Recent Transactions: ${signatures.length}`);
    
    for (const sig of signatures.slice(0, 5)) {
      const tx = await connection.getTransaction(sig.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (tx && tx.meta) {
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];
        const accountKeys = tx.transaction.message.accountKeys;
        
        // Find vault PDA in transaction
        const vaultIndex = accountKeys.findIndex((key: any) => 
          key.toString() === vaultPda
        );
        
        if (vaultIndex >= 0) {
          const preBalance = preBalances[vaultIndex] || 0;
          const postBalance = postBalances[vaultIndex] || 0;
          const balanceChange = (preBalance - postBalance) / LAMPORTS_PER_SOL;
          
          if (balanceChange > 0) {
            console.log(`   ✅ Transaction ${sig.signature.substring(0, 16)}...`);
            console.log(`      Vault sent: ${balanceChange.toFixed(6)} SOL`);
            console.log(`      Status: ${tx.meta.err ? 'FAILED' : 'SUCCESS'}`);
          }
        }
      }
    }
    
    return {
      matchId,
      vaultPda,
      currentBalance: vaultBalance / LAMPORTS_PER_SOL,
      transactionCount: signatures.length
    };
  } catch (error) {
    console.error(`❌ Error checking vault ${vaultAddress}:`, error);
    return null;
  }
}

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connected');
    
    // Check the specific match
    const matchId = process.argv[2] || 'efb88c06-d5ac-4199-867b-d54b22203580';
    const matchRepository = AppDataSource.getRepository(Match);
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match || !match.squadsVaultAddress || !match.squadsVaultPda) {
      console.error('❌ Match not found or missing vault info');
      process.exit(1);
    }
    
    console.log('\n💰 VERIFYING VAULT EXECUTION ON-CHAIN\n');
    console.log('═'.repeat(70));
    
    const result = await verifyVaultExecution(
      match.id,
      match.squadsVaultAddress,
      match.squadsVaultPda
    );
    
    if (result) {
      console.log('\n📊 Summary:');
      console.log(`   Current Vault Balance: ${result.currentBalance.toFixed(6)} SOL`);
      console.log(`   Expected Balance: ~0.0025 SOL (rent reserve)`);
      
      if (result.currentBalance > 0.01) {
        console.log('   ⚠️  WARNING: Vault still has significant balance - funds may not have been released');
      } else {
        console.log('   ✅ Vault balance is at rent reserve - funds likely released');
      }
    }
    
    console.log('═'.repeat(70));
    console.log('\n💡 Next Steps:');
    console.log('   1. Check Solana Explorer for the vault PDA address');
    console.log('   2. Verify transaction history shows outbound transfers');
    console.log('   3. Check if execution transactions succeeded despite timeouts\n');
    
    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { verifyVaultExecution };


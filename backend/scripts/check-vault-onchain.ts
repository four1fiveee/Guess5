/**
 * Quick script to check vault balance and transaction history on Solana devnet
 * Usage: npx ts-node scripts/check-vault-onchain.ts <vaultPda>
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

async function checkVault(vaultPda: string) {
  try {
    const vaultPubkey = new PublicKey(vaultPda);
    const balance = await connection.getBalance(vaultPubkey, 'confirmed');
    
    console.log(`\n🔍 Checking Vault: ${vaultPda}`);
    console.log(`   Current Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`   Expected if executed: ~0.0025 SOL (rent reserve)`);
    
    if (balance > 0.01) {
      console.log(`   ⚠️  WARNING: Vault still has significant balance - funds may not have been released`);
    } else {
      console.log(`   ✅ Vault balance is at rent reserve - funds likely released`);
    }
    
    // Get transaction history
    console.log(`\n📜 Recent Transaction History:`);
    const signatures = await connection.getSignaturesForAddress(vaultPubkey, { limit: 10 });
    console.log(`   Found ${signatures.length} recent transactions`);
    
    for (const sig of signatures.slice(0, 5)) {
      const tx = await connection.getTransaction(sig.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (tx && tx.meta) {
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];
        const accountKeys = tx.transaction.message.accountKeys;
        
        // Find vault in transaction
        const vaultIndex = accountKeys.findIndex((key: any) => 
          key.toString() === vaultPda
        );
        
        if (vaultIndex >= 0) {
          const preBalance = preBalances[vaultIndex] || 0;
          const postBalance = postBalances[vaultIndex] || 0;
          const balanceChange = (preBalance - postBalance) / LAMPORTS_PER_SOL;
          
          if (Math.abs(balanceChange) > 0.0001) {
            console.log(`\n   Transaction: ${sig.signature}`);
            console.log(`      Slot: ${sig.slot}`);
            console.log(`      Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
            console.log(`      Balance Change: ${balanceChange > 0 ? '-' : '+'}${Math.abs(balanceChange).toFixed(6)} SOL`);
            console.log(`      Status: ${tx.meta.err ? '❌ FAILED' : '✅ SUCCESS'}`);
            if (tx.meta.err) {
              console.log(`      Error: ${JSON.stringify(tx.meta.err)}`);
            }
          }
        }
      }
    }
    
    console.log(`\n💡 View on Solana Explorer: https://explorer.solana.com/address/${vaultPda}?cluster=devnet\n`);
    
  } catch (error) {
    console.error(`❌ Error checking vault:`, error);
  }
}

const vaultPda = process.argv[2];
if (!vaultPda) {
  console.error('Usage: npx ts-node scripts/check-vault-onchain.ts <vaultPda>');
  process.exit(1);
}

checkVault(vaultPda);





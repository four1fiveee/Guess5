/**
 * Diagnostic script to check transaction status on-chain
 * Usage: node backend/src/scripts/check-transaction-status.js <txSignature>
 */

const { Connection, PublicKey } = require('@solana/web3.js');

async function checkTransaction(txSig) {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  console.log('🔍 Checking transaction:', txSig);
  console.log('🌐 RPC:', connection.rpcEndpoint);

  try {
    const tx = await connection.getTransaction(txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      console.error('❌ Transaction not found on-chain');
      console.log('💡 This could mean:');
      console.log('   - Transaction was never confirmed');
      console.log('   - Transaction signature is invalid');
      console.log('   - RPC node has not indexed this transaction yet');
      return;
    }

    console.log('\n✅ Transaction found on-chain');
    console.log('📊 Transaction Details:');
    console.log('   Slot:', tx.slot);
    console.log('   Block Time:', tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A');
    console.log('   Fee:', tx.meta?.fee, 'lamports');

    // Check if transaction succeeded or failed
    if (tx.meta?.err) {
      console.log('\n❌ TRANSACTION FAILED');
      console.log('   Error:', JSON.stringify(tx.meta.err, null, 2));
    } else {
      console.log('\n✅ TRANSACTION SUCCEEDED');
    }

    // Show program logs
    if (tx.meta?.logMessages && tx.meta.logMessages.length > 0) {
      console.log('\n📝 Program Logs:');
      tx.meta.logMessages.forEach((log, i) => {
        const isError = log.includes('failed') || log.includes('error') || log.includes('Error') || log.includes('revert');
        const prefix = isError ? '❌' : '  ';
        console.log(`${prefix} [${i}] ${log}`);
      });

      // Look for specific Squads errors
      const errorLogs = tx.meta.logMessages.filter(log => 
        log.includes('failed') || 
        log.includes('error') || 
        log.includes('Error') ||
        log.includes('Constraint') ||
        log.includes('AccountMismatch') ||
        log.includes('MissingAccount') ||
        log.includes('IncorrectProgramId') ||
        log.includes('AccountNotWritable') ||
        log.includes('Signer') ||
        log.includes('Borsh')
      );

      if (errorLogs.length > 0) {
        console.log('\n🚨 CRITICAL ERRORS FOUND:');
        errorLogs.forEach(log => console.log('   ❌', log));
      }
    }

    // Show account changes
    if (tx.meta?.preBalances && tx.meta?.postBalances) {
      console.log('\n💰 Balance Changes:');
      tx.transaction.message.accountKeys.forEach((key, i) => {
        const pre = tx.meta.preBalances[i];
        const post = tx.meta.postBalances[i];
        const diff = post - pre;
        if (diff !== 0) {
          console.log(`   ${key.toString().slice(0, 8)}...: ${pre} → ${post} (${diff > 0 ? '+' : ''}${diff} lamports)`);
        }
      });
    }

    // Show inner instructions (Squads program calls)
    if (tx.meta?.innerInstructions && tx.meta.innerInstructions.length > 0) {
      console.log('\n🔧 Inner Instructions:');
      tx.meta.innerInstructions.forEach((inner, i) => {
        console.log(`   Instruction ${i}:`);
        if (inner.instructions) {
          inner.instructions.forEach((ix, j) => {
            console.log(`     [${j}] Program: ${tx.transaction.message.accountKeys[ix.programIdIndex]?.toString() || 'unknown'}`);
          });
        }
      });
    }

    console.log('\n🔗 View on Explorer:');
    console.log(`   https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  } catch (error) {
    console.error('❌ Error checking transaction:', error.message);
    console.error(error.stack);
  }
}

const txSig = process.argv[2];
if (!txSig) {
  console.error('Usage: node check-transaction-status.js <txSignature>');
  process.exit(1);
}

checkTransaction(txSig).then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});


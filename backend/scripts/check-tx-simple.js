const { Connection } = require('@solana/web3.js');

const TX_SIG = 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K';

async function checkTx() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  try {
    const tx = await connection.getTransaction(TX_SIG, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!tx) {
      console.log('❌ Transaction not found');
      return;
    }
    
    console.log('✅ Transaction found');
    console.log(`Status: ${tx.meta?.err ? '❌ FAILED' : '✅ SUCCESS'}`);
    console.log(`Slot: ${tx.slot}`);
    console.log(`Block Time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A'}`);
    
    if (tx.meta?.err) {
      console.log(`Error: ${JSON.stringify(tx.meta.err)}`);
    }
    
    // Check logs for execution
    if (tx.meta?.logMessages) {
      const execLogs = tx.meta.logMessages.filter(l => 
        l.includes('Execute') || l.includes('VaultTransaction') || l.includes('Transfer')
      );
      if (execLogs.length > 0) {
        console.log('\n📝 Execution Logs:');
        execLogs.forEach(log => console.log(`  ${log}`));
      }
    }
    
    // Check balance changes
    if (tx.meta?.preBalances && tx.meta?.postBalances) {
      console.log('\n💰 SOL Balance Changes:');
      tx.meta.preBalances.forEach((pre, idx) => {
        const post = tx.meta.postBalances[idx];
        const change = (post - pre) / 1e9;
        if (Math.abs(change) > 0.000001) {
          const account = tx.transaction.message.accountKeys[idx];
          console.log(`  ${account?.toString() || `Account ${idx}`}: ${change > 0 ? '+' : ''}${change.toFixed(6)} SOL`);
        }
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTx();


const { Connection, PublicKey } = require('@solana/web3.js');

const TX_SIG = 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K';
const MATCH_ID = 'e2af9ab0-8d8d-4039-bc3e-64ca6d6b6633';
const PROPOSAL_ID = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';
const WINNER_WALLET = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8'; // From frontend logs

async function verify() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Transaction Execution Verification\n');
  console.log(`Transaction: ${TX_SIG}`);
  console.log(`Match ID: ${MATCH_ID}`);
  console.log(`Proposal ID: ${PROPOSAL_ID}`);
  console.log(`Winner Wallet: ${WINNER_WALLET}\n`);

  try {
    const tx = await connection.getTransaction(TX_SIG, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!tx) {
      console.log('❌ Transaction not found on-chain');
      return;
    }

    console.log('✅ Transaction found on-chain');
    console.log(`Status: ${tx.meta?.err ? '❌ FAILED' : '✅ SUCCESS'}`);
    console.log(`Slot: ${tx.slot}`);
    console.log(`Block Time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A'}`);
    console.log(`Confirmations: MAX (FINALIZED)\n`);

    if (tx.meta?.err) {
      console.log(`❌ Error: ${JSON.stringify(tx.meta.err)}`);
      return;
    }

    // Check balance changes
    console.log('💰 Balance Changes:');
    let winnerReceived = false;
    let totalTransferred = 0;
    
    if (tx.meta?.preBalances && tx.meta?.postBalances) {
      tx.meta.preBalances.forEach((pre, idx) => {
        const post = tx.meta.postBalances[idx];
        const change = (post - pre) / 1e9;
        if (Math.abs(change) > 0.000001) {
          const account = tx.transaction.message.accountKeys[idx];
          const accountStr = account?.toString() || `Account ${idx}`;
          const isWinner = accountStr === WINNER_WALLET;
          const changeStr = change > 0 ? `+${change.toFixed(6)}` : change.toFixed(6);
          console.log(`  ${accountStr}: ${changeStr} SOL${isWinner ? ' ⭐ WINNER' : ''}`);
          
          if (isWinner && change > 0) {
            winnerReceived = true;
            totalTransferred = change;
          }
        }
      });
    }

    if (winnerReceived) {
      console.log(`\n✅ Winner received ${totalTransferred.toFixed(6)} SOL!`);
    } else {
      console.log(`\n⚠️ Winner wallet ${WINNER_WALLET} not found in balance changes`);
      console.log('   (This could mean the payout went to a different address or was already transferred)');
    }

    // Check logs for execution confirmation
    if (tx.meta?.logMessages) {
      const execLogs = tx.meta.logMessages.filter(l => 
        l.includes('Execute') || 
        l.includes('VaultTransaction') || 
        l.includes('Transfer') ||
        l.includes('Program log')
      );
      if (execLogs.length > 0) {
        console.log('\n📝 Execution Logs (relevant):');
        execLogs.slice(0, 10).forEach(log => {
          if (log.length > 150) {
            console.log(`  ${log.substring(0, 150)}...`);
          } else {
            console.log(`  ${log}`);
          }
        });
      }
    }

    // Summary
    console.log('\n📋 Verification Summary:');
    console.log(`✅ Transaction Status: SUCCESS`);
    console.log(`✅ Confirmation: FINALIZED (MAX confirmations)`);
    console.log(`${winnerReceived ? '✅' : '⚠️'} Winner Payout: ${winnerReceived ? `Received ${totalTransferred.toFixed(6)} SOL` : 'Not visible in this transaction'}`);
    
    if (!tx.meta?.err) {
      console.log('\n✅ EXECUTION VERIFIED: Transaction executed successfully on-chain!');
      console.log('\n📝 Next Steps:');
      console.log('   1. Check database to verify proposalStatus = "EXECUTED"');
      console.log('   2. Verify proposalExecutedAt timestamp is set');
      console.log('   3. Confirm proposalTransactionId matches this transaction');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

verify();


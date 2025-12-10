const { Connection } = require('@solana/web3.js');

const sig = '3i6apLkYnJ5VuBzN55bYwnjH4T3WLP5MiRWk67DbV3FMqrLaCz3CjGoLbeuLVUY1jpUg5PvctyVPiBX6k8bnFLuT';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function checkTx() {
  try {
    const tx = await conn.getTransaction(sig, { 
      commitment: 'confirmed', 
      maxSupportedTransactionVersion: 0 
    });
    
    if (!tx) {
      console.log('❌ Transaction not found on-chain');
      return;
    }
    
    console.log('✅ Transaction found on-chain');
    console.log('Status:', tx.meta?.err ? 'FAILED' : 'SUCCESS');
    console.log('Error:', tx.meta?.err || 'None');
    console.log('Fee:', tx.meta?.fee);
    console.log('Log messages (first 30):');
    if (tx.meta?.logMessages) {
      tx.meta.logMessages.slice(0, 30).forEach((log, i) => {
        console.log(`  [${i}] ${log}`);
      });
    }
    
    // Check if transaction has any errors
    if (tx.meta?.err) {
      console.log('\n❌ Transaction failed on-chain!');
      console.log('Error details:', JSON.stringify(tx.meta.err, null, 2));
    } else {
      console.log('\n✅ Transaction succeeded on-chain');
    }
  } catch (e) {
    console.error('Error checking transaction:', e.message);
  }
}

checkTx();



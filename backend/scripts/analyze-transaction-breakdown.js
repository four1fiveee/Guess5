const { Connection, PublicKey } = require('@solana/web3.js');

// Try the most recent execution transaction first
const TX_SIG = process.argv[2] || '3oBHEVaFAa86NkVtSuQ25NM4RwumQogWCiqC9ToqE4qhagUmBEGqLLpFKcSdBMLm6M6gEng2eFmt8vvjM8dd8v5P';
const MATCH_ID = 'e2af9ab0-8d8d-4039-bc3e-64ca6d6b6633';
const WINNER_WALLET = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

async function analyzeTransaction() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🔍 Analyzing Transaction Breakdown\n');
  console.log(`Transaction: ${TX_SIG}`);
  console.log(`Match ID: ${MATCH_ID}\n`);

  try {
    const tx = await connection.getTransaction(TX_SIG, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!tx) {
      console.log('❌ Transaction not found');
      return;
    }

    if (tx.meta?.err) {
      console.log(`❌ Transaction failed: ${JSON.stringify(tx.meta.err)}`);
      return;
    }

    console.log('✅ Transaction found and successful\n');

    // Get account keys - handle both v0 and legacy transactions
    let accountKeys;
    if (tx.transaction.message.staticAccountKeys) {
      accountKeys = tx.transaction.message.staticAccountKeys;
    } else if (tx.transaction.message.accountKeys) {
      accountKeys = tx.transaction.message.accountKeys;
    } else {
      console.log('❌ Could not find account keys');
      return;
    }
    
    const preBalances = tx.meta.preBalances || [];
    const postBalances = tx.meta.postBalances || [];
    const preTokenBalances = tx.meta.preTokenBalances || [];
    const postTokenBalances = tx.meta.postTokenBalances || [];

    console.log('📊 Balance Changes (SOL):\n');
    console.log('Account'.padEnd(50), 'Pre-Balance (SOL)'.padEnd(20), 'Post-Balance (SOL)'.padEnd(20), 'Change (SOL)');
    console.log('-'.repeat(120));

    const balanceChanges = [];
    const numAccounts = Math.min(accountKeys.length, preBalances.length, postBalances.length);
    
    for (let i = 0; i < numAccounts; i++) {
      const account = accountKeys[i];
      const pubkey = account.pubkey ? account.pubkey.toString() : account.toString();
      const preBalance = (preBalances[i] || 0) / 1e9;
      const postBalance = (postBalances[i] || 0) / 1e9;
      const change = postBalance - preBalance;

      if (Math.abs(change) > 0.000001) { // Only show accounts with meaningful changes
        const isSigner = account.signer !== undefined ? account.signer : false;
        const isWritable = account.writable !== undefined ? account.writable : false;
        
        balanceChanges.push({
          pubkey,
          preBalance,
          postBalance,
          change,
          isSigner,
          isWritable
        });
        
        const signerMark = isSigner ? '[S]' : '';
        const writableMark = isWritable ? '[W]' : '';
        console.log(
          `${pubkey.slice(0, 44)}...${signerMark}${writableMark}`.padEnd(50),
          preBalance.toFixed(9).padEnd(20),
          postBalance.toFixed(9).padEnd(20),
          change > 0 ? `+${change.toFixed(9)}` : change.toFixed(9)
        );
      }
    }

    console.log('\n💰 Initial Summary:\n');
    
    // Calculate total SOL moved
    const initialTotalSent = balanceChanges
      .filter(b => b.change < 0)
      .reduce((sum, b) => sum + Math.abs(b.change), 0);
    
    const initialTotalReceived = balanceChanges
      .filter(b => b.change > 0)
      .reduce((sum, b) => sum + b.change, 0);

    console.log(`Total SOL Sent: ${initialTotalSent.toFixed(9)}`);
    console.log(`Total SOL Received: ${initialTotalReceived.toFixed(9)}`);
    console.log(`Net Difference (fees/costs): ${(initialTotalSent - initialTotalReceived).toFixed(9)} SOL\n`);

    // Try to identify winner, fee wallet, and vault
    console.log('🎯 Key Accounts:\n');
    
    const feeWalletChange = balanceChanges.find(b => b.pubkey === FEE_WALLET);
    const winnerChange = balanceChanges.find(b => b.pubkey === WINNER_WALLET);
    
    if (feeWalletChange) {
      console.log(`Fee Wallet (${FEE_WALLET.slice(0, 8)}...): ${feeWalletChange.change > 0 ? '+' : ''}${feeWalletChange.change.toFixed(9)} SOL`);
    } else {
      console.log(`Fee Wallet: No balance change detected`);
    }
    
    if (winnerChange) {
      console.log(`Winner Wallet (${WINNER_WALLET.slice(0, 8)}...): ${winnerChange.change > 0 ? '+' : ''}${winnerChange.change.toFixed(9)} SOL`);
    } else {
      console.log(`Winner Wallet: No balance change detected`);
    }
    
    // Calculate totals
    console.log('\n💰 Fund Breakdown:\n');
    const totalSent = balanceChanges.filter(b => b.change < 0).reduce((sum, b) => sum + Math.abs(b.change), 0);
    const totalReceived = balanceChanges.filter(b => b.change > 0).reduce((sum, b) => sum + b.change, 0);
    const fees = totalSent - totalReceived;
    
    console.log(`Total SOL Sent: ${totalSent.toFixed(9)} SOL`);
    console.log(`Total SOL Received: ${totalReceived.toFixed(9)} SOL`);
    console.log(`Total Fees/Costs: ${fees.toFixed(9)} SOL`);
    
    if (winnerChange && winnerChange.change > 0) {
      console.log(`\n✅ Winner Received: ${winnerChange.change.toFixed(9)} SOL`);
    }
    if (feeWalletChange && feeWalletChange.change > 0) {
      console.log(`✅ Fee Wallet Received: ${feeWalletChange.change.toFixed(9)} SOL`);
    }

    // Find largest recipients (likely winner)
    console.log('\n📈 Top Recipients:\n');
    const recipients = balanceChanges
      .filter(b => b.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 5);
    
    recipients.forEach((r, i) => {
      console.log(`${i + 1}. ${r.pubkey.slice(0, 44)}...: +${r.change.toFixed(9)} SOL`);
    });

    // Find largest senders (likely vault)
    console.log('\n📉 Top Senders:\n');
    const senders = balanceChanges
      .filter(b => b.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, 5);
    
    senders.forEach((s, i) => {
      console.log(`${i + 1}. ${s.pubkey.slice(0, 44)}...: ${s.change.toFixed(9)} SOL`);
    });

    // Transaction fees
    const fee = tx.meta.fee / 1e9;
    console.log(`\n⛽ Transaction Fee: ${fee.toFixed(9)} SOL`);

    // Logs might contain useful info
    if (tx.meta.logMessages && tx.meta.logMessages.length > 0) {
      console.log('\n📝 Transaction Logs (first 10):\n');
      tx.meta.logMessages.slice(0, 10).forEach((log, i) => {
        console.log(`${i + 1}. ${log}`);
      });
    }

  } catch (error) {
    console.error('❌ Error analyzing transaction:', error);
  }
}

analyzeTransaction().catch(console.error);


const { Connection, PublicKey } = require('@solana/web3.js');

const TRANSACTION_SIGNATURE = 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K';
const MATCH_ID = 'e2af9ab0-8d8d-4039-bc3e-64ca6d6b6633';
const PROPOSAL_ID = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';

async function verifyTransaction() {
  const networkUrl = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(networkUrl, 'confirmed');

  console.log('🔍 Verifying transaction execution...\n');
  console.log(`Transaction: ${TRANSACTION_SIGNATURE}`);
  console.log(`Match ID: ${MATCH_ID}`);
  console.log(`Proposal ID: ${PROPOSAL_ID}\n`);

  try {
    // Check transaction status
    const tx = await connection.getTransaction(TRANSACTION_SIGNATURE, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!tx) {
      console.log('❌ Transaction not found on-chain');
      return;
    }

    console.log('✅ Transaction found on-chain\n');
    console.log('Transaction Details:');
    console.log(`- Slot: ${tx.slot}`);
    console.log(`- Block Time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A'}`);
    console.log(`- Status: ${tx.meta?.err ? '❌ FAILED' : '✅ SUCCESS'}`);
    
    if (tx.meta?.err) {
      console.log(`- Error: ${JSON.stringify(tx.meta.err)}`);
    }

    // Check transaction instructions
    console.log('\n📋 Transaction Instructions:');
    if (tx.transaction.message.instructions) {
      tx.transaction.message.instructions.forEach((ix, idx) => {
        console.log(`  ${idx + 1}. Program: ${ix.programId?.toString() || 'N/A'}`);
      });
    }

    // Check account changes (balance changes)
    if (tx.meta?.preBalances && tx.meta?.postBalances) {
      console.log('\n💰 Balance Changes:');
      tx.meta.preTokenBalances?.forEach((pre, idx) => {
        const post = tx.meta.postTokenBalances?.[idx];
        if (pre && post) {
          const change = post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount;
          if (change !== 0) {
            console.log(`  Account ${pre.owner}: ${change > 0 ? '+' : ''}${change} ${pre.mint}`);
          }
        }
      });

      // Check SOL balance changes
      tx.meta.preBalances.forEach((preBalance, idx) => {
        const postBalance = tx.meta.postBalances[idx];
        const change = (postBalance - preBalance) / 1e9; // Convert lamports to SOL
        if (Math.abs(change) > 0.000001) {
          const account = tx.transaction.message.accountKeys[idx];
          console.log(`  ${account?.toString() || `Account ${idx}`}: ${change > 0 ? '+' : ''}${change.toFixed(6)} SOL`);
        }
      });
    }

    // Check logs for execution confirmation
    if (tx.meta?.logMessages) {
      console.log('\n📝 Transaction Logs (relevant):');
      const relevantLogs = tx.meta.logMessages.filter(log => 
        log.includes('Execute') || 
        log.includes('VaultTransaction') || 
        log.includes('Proposal') ||
        log.includes('Transfer')
      );
      relevantLogs.forEach(log => console.log(`  ${log}`));
    }

    // Verify proposal execution
    console.log('\n🔍 Checking proposal status...');
    try {
      const { accounts } = require('@sqds/multisig');
      const proposalPda = new PublicKey(PROPOSAL_ID);
      
      // Try to fetch the proposal account
      const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
      console.log(`✅ Proposal account found`);
      console.log(`- Status: ${proposalAccount.status}`);
      console.log(`- Executed: ${proposalAccount.executed}`);
    } catch (proposalError) {
      console.log(`⚠️ Could not fetch proposal account: ${proposalError.message}`);
    }

    console.log('\n✅ Transaction verification complete');
    
  } catch (error) {
    console.error('❌ Error verifying transaction:', error.message);
    console.error(error.stack);
  }
}

verifyTransaction().catch(console.error);


const { Connection, PublicKey } = require('@solana/web3.js');
const { AppDataSource } = require('../src/db/index');
const { Match } = require('../src/models/Match');

const MATCH_ID = 'e2af9ab0-8d8d-4039-bc3e-64ca6d6b6633';
const TX_SIG = 'HrxKspqjjDgshJMMCkjMAsrALuUDdZkmHL9DYxXxHSRSPzV3eUbWVoekKmTfybGsB8LSyt4emtMnL4D1vPYNZ2K';
const PROPOSAL_ID = 'GQr8DKgTzLcEmdTrit8XpwvZZ6oSuq2iX9UDShu6Z8PQ';

async function verifyExecution() {
  console.log('🔍 Verifying Match Execution\n');
  console.log(`Match ID: ${MATCH_ID}`);
  console.log(`Transaction: ${TX_SIG}`);
  console.log(`Proposal ID: ${PROPOSAL_ID}\n`);

  // Initialize database
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  try {
    // 1. Check Database Status
    console.log('📊 Checking Database Status...');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: MATCH_ID } });

    if (!match) {
      console.log('❌ Match not found in database');
      return;
    }

    console.log('✅ Match found in database');
    console.log(`- Status: ${match.status}`);
    console.log(`- Proposal Status: ${match.proposalStatus || 'NULL'}`);
    console.log(`- Proposal ID: ${match.payoutProposalId || 'NULL'}`);
    console.log(`- Proposal TX ID: ${match.proposalTransactionId || 'NULL'}`);
    console.log(`- Proposal Executed At: ${match.proposalExecutedAt || 'NULL'}`);
    console.log(`- Needs Signatures: ${match.needsSignatures || 'NULL'}`);
    console.log(`- Proposal Signers: ${match.proposalSigners || 'NULL'}`);
    console.log(`- Player 1: ${match.player1}`);
    console.log(`- Player 2: ${match.player2}`);
    console.log(`- Winner: ${match.winner || 'NULL'}`);
    console.log(`- Entry Fee: ${match.entryFee?.toString() || 'NULL'} SOL\n`);

    // 2. Check Transaction on-chain
    console.log('🔗 Checking Transaction on Solana...');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com', 'confirmed');
    const tx = await connection.getTransaction(TX_SIG, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!tx) {
      console.log('❌ Transaction not found on-chain');
      return;
    }

    console.log('✅ Transaction found on-chain');
    console.log(`- Status: ${tx.meta?.err ? '❌ FAILED' : '✅ SUCCESS'}`);
    console.log(`- Slot: ${tx.slot}`);
    console.log(`- Block Time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A'}`);
    
    if (tx.meta?.err) {
      console.log(`- Error: ${JSON.stringify(tx.meta.err)}`);
    }

    // Check balance changes
    if (tx.meta?.preBalances && tx.meta?.postBalances) {
      console.log('\n💰 SOL Balance Changes:');
      const winnerWallet = match.winner || (match.player1 === match.winner ? match.player1 : match.player2);
      let winnerReceived = false;
      
      tx.meta.preBalances.forEach((pre, idx) => {
        const post = tx.meta.postBalances[idx];
        const change = (post - pre) / 1e9;
        if (Math.abs(change) > 0.000001) {
          const account = tx.transaction.message.accountKeys[idx];
          const accountStr = account?.toString() || `Account ${idx}`;
          const isWinner = winnerWallet && accountStr === winnerWallet;
          console.log(`  ${accountStr}: ${change > 0 ? '+' : ''}${change.toFixed(6)} SOL${isWinner ? ' ⭐ WINNER' : ''}`);
          if (isWinner && change > 0) {
            winnerReceived = true;
          }
        }
      });

      if (winnerReceived) {
        console.log('\n✅ Winner received payout!');
      } else if (winnerWallet) {
        console.log(`\n⚠️ Winner wallet ${winnerWallet} not found in balance changes`);
      }
    }

    // Check logs
    if (tx.meta?.logMessages) {
      const execLogs = tx.meta.logMessages.filter(l => 
        l.includes('Execute') || l.includes('VaultTransaction') || l.includes('Transfer')
      );
      if (execLogs.length > 0) {
        console.log('\n📝 Execution Logs:');
        execLogs.slice(0, 5).forEach(log => console.log(`  ${log}`));
      }
    }

    // 3. Verification Summary
    console.log('\n📋 Verification Summary:');
    console.log(`- Transaction Status: ${tx.meta?.err ? '❌ FAILED' : '✅ SUCCESS'}`);
    console.log(`- Database Proposal Status: ${match.proposalStatus || 'NULL'}`);
    console.log(`- Database Executed At: ${match.proposalExecutedAt ? '✅ SET' : '❌ NULL'}`);
    console.log(`- Database TX ID Match: ${match.proposalTransactionId === TX_SIG ? '✅ MATCH' : '❌ MISMATCH'}`);

    if (!tx.meta?.err && match.proposalStatus === 'EXECUTED' && match.proposalExecutedAt) {
      console.log('\n✅ EXECUTION VERIFIED: Transaction succeeded and database updated correctly!');
    } else {
      console.log('\n⚠️ EXECUTION STATUS: Some verification checks failed');
      if (tx.meta?.err) console.log('  - Transaction failed on-chain');
      if (match.proposalStatus !== 'EXECUTED') console.log(`  - Database status is '${match.proposalStatus}' not 'EXECUTED'`);
      if (!match.proposalExecutedAt) console.log('  - Database proposalExecutedAt is NULL');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

verifyExecution().catch(console.error);


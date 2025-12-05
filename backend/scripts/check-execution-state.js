#!/usr/bin/env node
/**
 * Diagnostic script to check if a proposal is actually executing on-chain
 * or if it's just stuck in EXECUTING state in the database
 * 
 * Usage: node check-execution-state.js <matchId>
 * Example: node check-execution-state.js 5e5187ad-712e-4ef8-9ce9-93883d322427
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getProposalPda, getTransactionPda, getVaultPda } = require('@sqds/multisig');

const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'); // Devnet

async function checkExecutionState(matchId) {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    // Get match data from database
    const { AppDataSource } = require('../src/db/index');
    await AppDataSource.initialize();
    const matchRepository = AppDataSource.getRepository(require('../src/models/Match').Match);
    
    const matchRows = await matchRepository.query(`
      SELECT 
        id, "squadsVaultAddress", "payoutProposalId", "tieRefundProposalId",
        "proposalStatus", "proposalExecutedAt", "proposalTransactionId",
        "needsSignatures", "proposalSigners"
      FROM "match"
      WHERE id = $1
      LIMIT 1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    const match = matchRows[0];
    console.log('\n📊 DATABASE STATE:');
    console.log('Match ID:', match.id);
    console.log('Proposal Status:', match.proposalStatus);
    console.log('Proposal Executed At:', match.proposalExecutedAt);
    console.log('Proposal Transaction ID:', match.proposalTransactionId);
    console.log('Needs Signatures:', match.needsSignatures);
    console.log('Proposal Signers:', match.proposalSigners);
    console.log('Payout Proposal ID:', match.payoutProposalId);
    console.log('Tie Refund Proposal ID:', match.tieRefundProposalId);
    
    if (!match.squadsVaultAddress) {
      console.error('❌ No vault address found for match');
      process.exit(1);
    }
    
    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    if (!proposalId) {
      console.error('❌ No proposal ID found for match');
      process.exit(1);
    }
    
    const multisigAddress = new PublicKey(match.squadsVaultAddress);
    const proposalPda = new PublicKey(proposalId);
    
    console.log('\n🔍 ON-CHAIN PROPOSAL STATE:');
    console.log('Multisig Address:', multisigAddress.toString());
    console.log('Proposal PDA:', proposalPda.toString());
    
    // Check Proposal account
    try {
      const proposalAccount = await accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );
      
      const statusKind = proposalAccount.status?.__kind || 'Unknown';
      const executed = proposalAccount.executed || false;
      const approved = Array.isArray(proposalAccount.approved) 
        ? proposalAccount.approved.map((a) => a?.toString?.() || String(a))
        : [];
      const transactionIndex = proposalAccount.transactionIndex;
      
      console.log('\n✅ PROPOSAL ACCOUNT FOUND:');
      console.log('Status Kind:', statusKind);
      console.log('Executed:', executed);
      console.log('Approved Signers:', approved);
      console.log('Approved Count:', approved.length);
      console.log('Transaction Index:', transactionIndex?.toString());
      
      // Check VaultTransaction account
      if (transactionIndex !== undefined && transactionIndex !== null) {
        const [transactionPda] = getTransactionPda({
          multisigPda: multisigAddress,
          index: transactionIndex,
          programId: PROGRAM_ID,
        });
        
        try {
          const transactionAccount = await accounts.VaultTransaction.fromAccountAddress(
            connection,
            transactionPda
          );
          
          const vtStatus = transactionAccount.status;
          const vtStatusKind = vtStatus?.__kind || vtStatus;
          
          console.log('\n✅ VAULT TRANSACTION ACCOUNT FOUND:');
          console.log('Transaction PDA:', transactionPda.toString());
          console.log('VaultTransaction Status:', vtStatusKind);
          
          if (vtStatusKind === 'ExecuteReady') {
            console.log('✅ VaultTransaction is in ExecuteReady state - execution should succeed');
          } else if (vtStatusKind === 'Executed') {
            console.log('✅ VaultTransaction is already Executed - proposal was executed');
          } else {
            console.log('⚠️ VaultTransaction is NOT in ExecuteReady state:', vtStatusKind);
            console.log('   This is why execution might be failing');
          }
        } catch (txError) {
          console.warn('⚠️ Could not fetch VaultTransaction account:', txError.message);
        }
      }
      
      // DIAGNOSIS
      console.log('\n🔍 DIAGNOSIS:');
      if (executed) {
        console.log('✅ Proposal is EXECUTED on-chain');
        if (!match.proposalExecutedAt) {
          console.log('⚠️ ISSUE: Database shows proposal NOT executed, but on-chain shows EXECUTED');
          console.log('   This is a database sync issue - proposal was executed but DB was not updated');
        } else {
          console.log('✅ Database and on-chain state match - proposal is executed');
        }
      } else if (statusKind === 'ExecuteReady') {
        console.log('✅ Proposal is ExecuteReady on-chain - execution should proceed');
        if (match.proposalStatus === 'EXECUTING') {
          console.log('⚠️ ISSUE: Database shows EXECUTING but proposal is ExecuteReady on-chain');
          console.log('   Execution might have failed or is in progress');
        }
      } else if (statusKind === 'Approved') {
        console.log('⚠️ Proposal is Approved but NOT ExecuteReady');
        console.log('   This means validation has not passed yet');
        console.log('   Execution will fail until status transitions to ExecuteReady');
      } else {
        console.log('⚠️ Proposal status is:', statusKind);
        console.log('   Execution may not be possible in this state');
      }
      
      // Check if there are any recent execution transactions
      console.log('\n🔍 CHECKING FOR EXECUTION TRANSACTIONS:');
      try {
        const signatures = await connection.getSignaturesForAddress(proposalPda, { limit: 10 });
        console.log('Recent transactions for proposal PDA:', signatures.length);
        signatures.slice(0, 5).forEach((sig, idx) => {
          console.log(`  ${idx + 1}. ${sig.signature} (slot: ${sig.slot}, err: ${sig.err ? 'FAILED' : 'SUCCESS'})`);
        });
      } catch (sigError) {
        console.warn('⚠️ Could not fetch signatures:', sigError.message);
      }
      
    } catch (proposalError) {
      console.error('❌ Could not fetch proposal account:', proposalError.message);
      console.error(proposalError.stack);
    }
    
    await AppDataSource.destroy();
    
  } catch (error) {
    console.error('❌ Error checking execution state:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const matchId = process.argv[2];

if (!matchId) {
  console.error('❌ Usage: node check-execution-state.js <matchId>');
  console.error('Example: node check-execution-state.js 5e5187ad-712e-4ef8-9ce9-93883d322427');
  process.exit(1);
}

checkExecutionState(matchId).then(() => {
  console.log('\n✅ Diagnosis complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error during diagnosis:', error);
  process.exit(1);
});


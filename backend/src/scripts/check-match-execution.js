const { Connection, PublicKey } = require('@solana/web3.js');
const { AppDataSource } = require('../db');
const { Match } = require('../models/Match');
const { accounts, getProposalPda, getTransactionPda } = require('@sqds/multisig');

async function checkMatchExecution(matchId) {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connected');
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    console.log('\n📊 Match Database Status:');
    console.log('  Match ID:', match.id);
    console.log('  Status:', match.status);
    console.log('  Proposal Status:', match.proposalStatus);
    console.log('  Proposal ID:', match.payoutProposalId || match.tieRefundProposalId);
    console.log('  Proposal Signers:', match.proposalSigners);
    console.log('  Needs Signatures:', match.needsSignatures);
    console.log('  Proposal Executed At:', match.proposalExecutedAt);
    console.log('  Proposal Transaction ID:', match.proposalTransactionId);
    console.log('  Squads Vault Address:', match.squadsVaultAddress);
    console.log('  Updated At:', match.updatedAt);
    
    if (!match.squadsVaultAddress) {
      console.error('❌ No vault address found in database');
      process.exit(1);
    }
    
    const vaultAddress = new PublicKey(match.squadsVaultAddress);
    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    
    if (!proposalId) {
      console.error('❌ No proposal ID found in database');
      process.exit(1);
    }
    
    console.log('\n🔍 Checking On-Chain Status...');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
    const transactionIndex = parseInt(proposalId, 10);
    
    // Get Proposal PDA
    const [proposalPda] = getProposalPda({
      multisigPda: vaultAddress,
      transactionIndex: BigInt(transactionIndex),
      programId,
    });
    
    // Get Transaction PDA
    const [transactionPda] = getTransactionPda({
      multisigPda: vaultAddress,
      index: BigInt(transactionIndex),
      programId,
    });
    
    console.log('  Proposal PDA:', proposalPda.toString());
    console.log('  Transaction PDA:', transactionPda.toString());
    
    try {
      // Check Proposal account
      const proposalAccount = await accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda,
        'confirmed'
      );
      
      const proposalStatus = proposalAccount.status?.__kind;
      const approvedSigners = proposalAccount.approved || [];
      
      console.log('\n📋 Proposal On-Chain Status:');
      console.log('  Status:', proposalStatus);
      console.log('  Approved Signers:', approvedSigners.map(s => s.toString()));
      console.log('  Approved Count:', approvedSigners.length);
      
      // Check if executed
      const isExecuted = proposalStatus === 'Executed';
      console.log('  Is Executed:', isExecuted);
      
      if (isExecuted) {
        console.log('\n✅ Proposal has been executed on-chain!');
        console.log('  Database should show proposalExecutedAt:', match.proposalExecutedAt);
        
        if (!match.proposalExecutedAt) {
          console.log('  ⚠️ WARNING: Database does not show execution timestamp, but on-chain shows executed!');
        }
      } else {
        console.log('\n⏳ Proposal is NOT executed on-chain yet');
        console.log('  Current Status:', proposalStatus);
        console.log('  Approved Signers:', approvedSigners.length);
        
        if (proposalStatus === 'Approved' && approvedSigners.length >= 2) {
          console.log('  ⚠️ Proposal has enough approvals but status is not ExecuteReady/Executed');
          console.log('  This may indicate execution is stuck or failed');
        }
      }
      
      // Check Transaction account
      try {
        const transactionAccount = await accounts.VaultTransaction.fromAccountAddress(
          connection,
          transactionPda,
          'confirmed'
        );
        
        console.log('\n📋 VaultTransaction On-Chain Status:');
        console.log('  Transaction PDA exists: true');
        console.log('  Vault Index:', transactionAccount.vaultIndex);
        
        // In Squads v4, VaultTransaction doesn't have status - Proposal status is the source of truth
        console.log('  Note: VaultTransaction status is determined by Proposal status in Squads v4');
      } catch (txError) {
        console.log('\n❌ Could not fetch VaultTransaction account:', txError.message);
      }
      
    } catch (proposalError) {
      console.error('\n❌ Error fetching Proposal account:', proposalError.message);
      console.error('  This may indicate the proposal does not exist on-chain');
    }
    
    // Check if there's an execution transaction signature
    if (match.proposalTransactionId) {
      console.log('\n🔍 Checking Execution Transaction...');
      const executionSig = match.proposalTransactionId;
      console.log('  Transaction Signature:', executionSig);
      
      try {
        const tx = await connection.getTransaction(executionSig, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (tx) {
          console.log('  Transaction Status:', tx.meta?.err ? 'Failed' : 'Success');
          console.log('  Slot:', tx.slot);
          console.log('  Block Time:', tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A');
          
          if (tx.meta?.err) {
            console.log('  Error:', JSON.stringify(tx.meta.err));
          } else {
            console.log('  ✅ Transaction succeeded on-chain');
          }
        } else {
          console.log('  ⚠️ Transaction not found (may not be confirmed yet)');
        }
      } catch (txError) {
        console.log('  ❌ Error fetching transaction:', txError.message);
      }
    }
    
    await AppDataSource.destroy();
    console.log('\n✅ Check complete');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node check-match-execution.js <matchId>');
  process.exit(1);
}

checkMatchExecution(matchId);


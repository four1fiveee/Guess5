const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getProposalPda } = require('@sqds/multisig');

async function checkProposalStatus(vaultAddress, proposalId) {
  try {
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
    const transactionIndex = parseInt(proposalId, 10);
    
    if (isNaN(transactionIndex)) {
      // Try to parse as base58 public key
      const proposalPda = new PublicKey(proposalId);
      console.log('📋 Checking Proposal PDA directly:', proposalPda.toString());
      
      try {
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          connection,
          proposalPda,
          'confirmed'
        );
        
        const proposalStatus = proposalAccount.status?.__kind;
        const approvedSigners = proposalAccount.approved || [];
        
        console.log('\n📋 Proposal On-Chain Status:');
        console.log('  Proposal PDA:', proposalPda.toString());
        console.log('  Status:', proposalStatus);
        console.log('  Approved Signers:', approvedSigners.map(s => s.toString()));
        console.log('  Approved Count:', approvedSigners.length);
        console.log('  Threshold:', proposalAccount.threshold || 'N/A');
        console.log('  Is Executed:', proposalStatus === 'Executed');
        
        return {
          status: proposalStatus,
          signers: approvedSigners.map(s => s.toString()),
          signerCount: approvedSigners.length,
          isExecuted: proposalStatus === 'Executed',
        };
      } catch (error) {
        console.error('❌ Error fetching proposal:', error.message);
        return null;
      }
    } else {
      // Derive PDA from vault and transaction index
      const multisigPda = new PublicKey(vaultAddress);
      const [proposalPda] = getProposalPda({
        multisigPda,
        transactionIndex: BigInt(transactionIndex),
        programId,
      });
      
      console.log('📋 Checking Proposal:', {
        vaultAddress: multisigPda.toString(),
        transactionIndex,
        proposalPda: proposalPda.toString(),
      });
      
      try {
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          connection,
          proposalPda,
          'confirmed'
        );
        
        const proposalStatus = proposalAccount.status?.__kind;
        const approvedSigners = proposalAccount.approved || [];
        
        console.log('\n📋 Proposal On-Chain Status:');
        console.log('  Proposal PDA:', proposalPda.toString());
        console.log('  Status:', proposalStatus);
        console.log('  Approved Signers:', approvedSigners.map(s => s.toString()));
        console.log('  Approved Count:', approvedSigners.length);
        console.log('  Threshold:', proposalAccount.threshold || 'N/A');
        console.log('  Is Executed:', proposalStatus === 'Executed');
        
        return {
          status: proposalStatus,
          signers: approvedSigners.map(s => s.toString()),
          signerCount: approvedSigners.length,
          isExecuted: proposalStatus === 'Executed',
        };
      } catch (error) {
        console.error('❌ Error fetching proposal:', error.message);
        return null;
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    return null;
  }
}

const vaultAddress = process.argv[2];
const proposalId = process.argv[3];

if (!vaultAddress || !proposalId) {
  console.error('Usage: node check-onchain-proposal-status.js <vaultAddress> <proposalId>');
  console.error('  proposalId can be a transaction index (number) or a Proposal PDA (base58)');
  process.exit(1);
}

checkProposalStatus(vaultAddress, proposalId).then(result => {
  if (result) {
    console.log('\n✅ Check complete');
    process.exit(0);
  } else {
    console.log('\n❌ Check failed');
    process.exit(1);
  }
});


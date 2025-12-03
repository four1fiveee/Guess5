/**
 * Script to check on-chain proposal status for a specific proposal
 * Usage: node check-proposal-onchain.js <vaultAddress> <proposalId>
 */

require('dotenv').config({ path: '../../.env' });
const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getProposalPda } = require('@sqds/multisig');

const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'); // Devnet

async function checkProposalStatus(vaultAddress, proposalId) {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    const multisigAddress = new PublicKey(vaultAddress);
    let proposalPda;
    let transactionIndex;

    // Try to parse as PDA first
    try {
      proposalPda = new PublicKey(proposalId);
      console.log('📋 Fetching proposal account:', proposalPda.toString());
      
      const proposalAccount = await accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );
      
      transactionIndex = proposalAccount.transactionIndex || proposalAccount.transactionIndex;
      console.log('✅ Proposal account found:', {
        proposalPda: proposalPda.toString(),
        transactionIndex: transactionIndex ? transactionIndex.toString() : 'N/A',
        executed: proposalAccount.executed !== undefined ? proposalAccount.executed : 'N/A',
        approved: proposalAccount.approved !== undefined ? proposalAccount.approved : 'N/A',
        signers: (proposalAccount.signers || []).map(s => s.toString()),
      });
    } catch (pdaError) {
      // Try as transactionIndex
      try {
        transactionIndex = BigInt(proposalId);
        const [derivedPda] = getProposalPda({
          multisigPda: multisigAddress,
          transactionIndex,
          programId: PROGRAM_ID,
        });
        proposalPda = derivedPda;
        console.log('✅ Derived proposal PDA from transactionIndex:', proposalPda.toString());
      } catch (bigIntError) {
        console.error('❌ Could not parse proposalId as PDA or transactionIndex');
        throw bigIntError;
      }
    }

    // Fetch proposal account
    const proposalAccount = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );

    // Get signers
    const signers = proposalAccount.signers || [];
    const signerAddresses = signers.map(s => s.toString());

    console.log('\n📊 ON-CHAIN PROPOSAL STATUS:');
    console.log('Proposal PDA:', proposalPda.toString());
    console.log('Transaction Index:', transactionIndex?.toString());
    console.log('Executed:', proposalAccount.executed);
    console.log('Approved:', proposalAccount.approved);
    console.log('Signers:', signerAddresses);
    console.log('Signer Count:', signerAddresses.length);
    
    // Check if specific wallet signed
    const userWallet = process.argv[4];
    if (userWallet) {
      const userSigned = signerAddresses.some(s => s.toLowerCase() === userWallet.toLowerCase());
      console.log(`\n👤 User ${userWallet} signed:`, userSigned);
    }

    // Get transaction account to check needsSignatures
    try {
      const transactionPda = proposalAccount.transactionPda;
      if (transactionPda) {
        const transactionAccount = await accounts.Transaction.fromAccountAddress(
          connection,
          transactionPda
        );
        const multisig = await accounts.Multisig.fromAccountAddress(
          connection,
          multisigAddress
        );
        const threshold = multisig.threshold;
        const needsSignatures = Math.max(0, Number(threshold) - signerAddresses.length);
        
        console.log('\n📋 TRANSACTION DETAILS:');
        console.log('Transaction PDA:', transactionPda.toString());
        console.log('Multisig Threshold:', threshold);
        console.log('Needs Signatures:', needsSignatures);
        console.log('Ready to Execute:', needsSignatures === 0);
      }
    } catch (txError) {
      console.warn('⚠️ Could not fetch transaction account:', txError.message);
    }

  } catch (error) {
    console.error('❌ Error checking proposal status:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const vaultAddress = process.argv[2];
const proposalId = process.argv[3] || process.argv[4]; // Allow for optional user wallet

if (!vaultAddress || !proposalId) {
  console.error('❌ Usage: node check-proposal-onchain.js <vaultAddress> <proposalId> [userWallet]');
  console.error('Example: node check-proposal-onchain.js 7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU HxdSbC3jQVXJpM39qDsXDPu1VyYkKoVmJ21VG6fRPT1u');
  process.exit(1);
}

checkProposalStatus(vaultAddress, proposalId).then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


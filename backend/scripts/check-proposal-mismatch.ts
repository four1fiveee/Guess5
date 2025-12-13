/**
 * Diagnostic script to check proposal mismatch for a specific match
 * Derives proposal PDAs and checks on-chain status
 */

import { PublicKey } from '@solana/web3.js';
import { getProposalPda, accounts, PROGRAM_ID } from '@sqds/multisig';
import { Connection } from '@solana/web3.js';

const multisigAddress = new PublicKey('HoR4nYNt3zxPu3aCdBmsNc8UccZbaacRuLcTEFfpx8Ey');
const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || PROGRAM_ID);

// Proposal IDs from the issue
const userSignedProposalId = '5d7PQcUSjPSZrVdr6p3au4oJZr9sEFA83P7pRKo3CRyN';
const correctProposalId = 'R2W2ektTyYSPBiKFnj9H7favUjfNHrYX3u9rJSG6Ajt';
const currentDbProposalId = '6EB3mjVpPxyTdBWe5JDwosQoroCn2VpR778XgmPsVuxk';

async function checkProposals() {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  console.log('🔍 Checking proposal PDAs for transaction indices 0-10...\n');
  console.log('Multisig Address:', multisigAddress.toString());
  console.log('Program ID:', programId.toString());
  console.log('\n---\n');

  // Check transaction indices 0-10
  for (let i = 0; i <= 10; i++) {
    try {
      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: BigInt(i),
        programId: programId,
      });

      const proposalId = proposalPda.toString();
      
      // Check if this matches any of our known proposal IDs
      let match = '';
      if (proposalId === userSignedProposalId) {
        match = ' ⭐ USER SIGNED THIS';
      } else if (proposalId === correctProposalId) {
        match = ' ⭐ CORRECT PROPOSAL';
      } else if (proposalId === currentDbProposalId) {
        match = ' ⭐ CURRENT DB PROPOSAL';
      }

      // Try to fetch the proposal account
      try {
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          connection,
          proposalPda
        );

        const status = (proposalAccount as any).status?.__kind || 'Unknown';
        const approved = (proposalAccount as any).approved || [];
        const approvedPubkeys = approved.map((p: PublicKey) => p.toString());

        console.log(`Transaction Index ${i}:`);
        console.log(`  Proposal PDA: ${proposalId}${match}`);
        console.log(`  Status: ${status}`);
        console.log(`  Approved Signers: ${approvedPubkeys.length}`);
        console.log(`  Signers: ${approvedPubkeys.join(', ')}`);
        console.log('');
      } catch (e: any) {
        if (e.message?.includes('AccountNotFound') || e.message?.includes('Invalid account')) {
          // Proposal doesn't exist at this index
          if (match) {
            console.log(`Transaction Index ${i}:`);
            console.log(`  Proposal PDA: ${proposalId}${match}`);
            console.log(`  Status: DOES NOT EXIST ON-CHAIN`);
            console.log('');
          }
        } else {
          console.log(`Transaction Index ${i}:`);
          console.log(`  Proposal PDA: ${proposalId}${match}`);
          console.log(`  Error fetching: ${e.message}`);
          console.log('');
        }
      }
    } catch (e: any) {
      console.log(`Transaction Index ${i}: Error deriving PDA - ${e.message}`);
    }
  }

  console.log('\n---\n');
  console.log('Summary:');
  console.log(`User tried to sign: ${userSignedProposalId}`);
  console.log(`Backend says correct: ${correctProposalId}`);
  console.log(`Current DB has: ${currentDbProposalId}`);
}

checkProposals().catch(console.error);


/**
 * Quick check of match execution - checks transaction signature and vault balance
 * Usage: npx ts-node scripts/check-match-quick.ts <matchId> <vaultPda> <proposalId> [signature]
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getTransactionPda, getProposalPda } from '@sqds/multisig';
import * as accounts from '@sqds/multisig/lib/codegen/accounts';

const MATCH_ID = process.argv[2];
const VAULT_PDA = process.argv[3];
const PROPOSAL_ID = process.argv[4];
const SIGNATURE = process.argv[5];

if (!MATCH_ID || !VAULT_PDA || !PROPOSAL_ID) {
  console.error('Usage: npx ts-node scripts/check-match-quick.ts <matchId> <vaultPda> <proposalId> [signature]');
  process.exit(1);
}

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const SQUADS_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

async function main() {
  console.log(`\n🔍 Checking Match: ${MATCH_ID}\n`);

  // Check vault balance
  try {
    const vaultPda = new PublicKey(VAULT_PDA);
    const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
    console.log('💰 Vault Balance:');
    console.log(`   ${(vaultBalance / 1e9).toFixed(6)} SOL (${vaultBalance} lamports)`);
  } catch (error: any) {
    console.error('❌ Error checking vault balance:', error.message);
  }

  // Check proposal state
  try {
    const multisigAddress = new PublicKey(VAULT_PDA);
    const transactionIndex = BigInt(PROPOSAL_ID);
    
    const [transactionPda] = getTransactionPda({
      multisigPda: multisigAddress,
      index: transactionIndex,
      programId: SQUADS_PROGRAM_ID,
    });

    const [proposalPda] = getProposalPda({
      multisigPda: multisigAddress,
      transactionIndex,
      programId: SQUADS_PROGRAM_ID,
    });

    console.log('\n📊 Proposal State:');
    console.log(`   Transaction PDA: ${transactionPda.toString()}`);
    console.log(`   Proposal PDA: ${proposalPda.toString()}`);

    // Check if transaction account exists (should be closed if executed)
    const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
    if (!transactionAccount) {
      console.log('   ✅ Transaction account CLOSED - Proposal was EXECUTED!');
    } else {
      console.log('   ⚠️  Transaction account EXISTS - Proposal NOT executed');
      
      // Decode transaction
      try {
        const transaction = await accounts.VaultTransaction.fromAccountAddress(connection, transactionPda);
        console.log(`   Executed: ${transaction.executed}`);
      } catch (e: any) {
        console.log(`   Error decoding: ${e.message}`);
      }
    }

    // Check proposal account
    try {
      const proposal = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
      const statusKey = proposal.status ? Object.keys(proposal.status)[0] : 'Unknown';
      const isExecuteReady = proposal.status && 'executeReady' in proposal.status;
      console.log(`   Status: ${statusKey} ${isExecuteReady ? '(ExecuteReady)' : ''}`);
      console.log(`   Approved Signers: ${proposal.approvedSigners?.length || 0}`);
    } catch (e: any) {
      console.log(`   Error decoding proposal: ${e.message}`);
    }
  } catch (error: any) {
    console.error('❌ Error checking proposal:', error.message);
  }

  // Check signature if provided
  if (SIGNATURE) {
    console.log(`\n🔍 Checking Signature: ${SIGNATURE.substring(0, 20)}...`);
    try {
      const [status, tx] = await Promise.all([
        connection.getSignatureStatuses([SIGNATURE], { searchTransactionHistory: true }),
        connection.getTransaction(SIGNATURE, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      ]);

      const s = status.value[0];
      console.log({
        found: !!s || !!tx,
        confirmed: s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized',
        err: s?.err || tx?.meta?.err,
        slot: s?.slot || tx?.slot,
        success: !s?.err && !tx?.meta?.err,
      });
    } catch (error: any) {
      console.error('❌ Error checking signature:', error.message);
    }
  }

  console.log('\n');
}

main().catch(console.error);



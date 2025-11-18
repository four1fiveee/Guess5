/**
 * Direct check - no database, just on-chain verification
 * Usage: npx ts-node scripts/check-match-direct.ts <vaultPda> <proposalId> [signature]
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getTransactionPda, getProposalPda } from '@sqds/multisig';
import * as accounts from '@sqds/multisig/lib/codegen/accounts';

const VAULT_PDA = process.argv[2];
const PROPOSAL_ID = process.argv[3];
const SIGNATURE = process.argv[4];
const PLAYER_WALLET = process.argv[5] || 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
const FEE_WALLET = process.argv[6] || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

if (!VAULT_PDA || !PROPOSAL_ID) {
  console.error('Usage: npx ts-node scripts/check-match-direct.ts <vaultPda> <proposalId> [signature] [playerWallet] [feeWallet]');
  process.exit(1);
}

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const SQUADS_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

async function checkBalance(address: string, label: string) {
  try {
    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey, 'confirmed');
    console.log(`   ${label}: ${(balance / 1e9).toFixed(6)} SOL (${balance} lamports)`);
    return balance;
  } catch (error: any) {
    console.error(`   ❌ Error checking ${label}:`, error.message);
    return 0;
  }
}

async function main() {
  console.log(`\n🔍 Checking On-Chain State\n`);

  // Check vault balance
  console.log('💰 Vault Balance:');
  const vaultBalance = await checkBalance(VAULT_PDA, 'Vault PDA');

  // Check player wallet balance
  console.log('\n👤 Player Wallet Balance:');
  await checkBalance(PLAYER_WALLET, 'Player');

  // Check fee wallet balance
  console.log('\n💼 Fee Wallet Balance:');
  await checkBalance(FEE_WALLET, 'Fee Wallet');

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
      console.log('   ✅ Funds should have been released');
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
      if (proposal.approvedSigners && proposal.approvedSigners.length > 0) {
        console.log(`   Signers: ${proposal.approvedSigners.map((s: PublicKey) => s.toString()).join(', ')}`);
      }
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
      const result = {
        found: !!s || !!tx,
        confirmed: s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized',
        err: s?.err || tx?.meta?.err,
        slot: s?.slot || tx?.slot,
        success: !s?.err && !tx?.meta?.err,
      };
      console.log(JSON.stringify(result, null, 2));
      
      if (tx) {
        console.log(`\n   Transaction Details:`);
        console.log(`   Block Time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A'}`);
        console.log(`   Fee: ${tx.meta?.fee || 0} lamports`);
        if (tx.meta?.preBalances && tx.meta?.postBalances) {
          console.log(`   Balance Changes:`);
          tx.transaction.message.accountKeys.forEach((key: any, i: number) => {
            const pre = tx.meta!.preBalances[i];
            const post = tx.meta!.postBalances[i];
            const change = post - pre;
            if (change !== 0) {
              console.log(`     ${key.toString().substring(0, 20)}...: ${(change / 1e9).toFixed(6)} SOL`);
            }
          });
        }
      }
    } catch (error: any) {
      console.error('❌ Error checking signature:', error.message);
    }
  }

  console.log('\n');
}

main().catch(console.error);



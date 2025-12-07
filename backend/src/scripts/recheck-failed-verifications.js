/**
 * Recovery Script: Re-check Failed Verifications
 * 
 * This script can be run manually or via cron to re-check proposals
 * that failed signature verification.
 * 
 * Usage:
 *   node backend/src/scripts/recheck-failed-verifications.js [matchId]
 * 
 * If matchId is provided, only that match will be checked.
 * Otherwise, all matches with SIGNATURE_VERIFICATION_FAILED status
 * from the last 24 hours will be checked.
 */

const { Client } = require('pg');
const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getProposalPda, PROGRAM_ID } = require('@sqds/multisig');

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require'
});

async function recheckVerification(matchId, proposalId, wallet, txSig, vaultAddress) {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const fallbackConnection = new Connection('https://api.devnet.solana.com', 'confirmed'); // Use same for now, but could be Helius/Triton
  
  const vaultPda = new PublicKey(vaultAddress);
  const signerPubkey = new PublicKey(wallet);
  
  // Get transactionIndex from proposal
  let transactionIndex = 0;
  try {
    const proposalPda = new PublicKey(proposalId);
    const proposal = await accounts.Proposal.fromAccountAddress(connection, proposalPda, 'confirmed');
    transactionIndex = Number(proposal.transactionIndex);
  } catch (e) {
    console.error(`❌ Could not get transactionIndex for ${matchId}:`, e.message);
    return { ok: false, reason: 'could_not_get_transaction_index' };
  }
  
  // Check transaction confirmation
  let txConfirmed = false;
  try {
    const tx = await connection.getTransaction(txSig, { commitment: 'confirmed' });
    if (tx) txConfirmed = true;
  } catch (e) {
    // Try fallback
    try {
      const tx2 = await fallbackConnection.getTransaction(txSig, { commitment: 'confirmed' });
      if (tx2) txConfirmed = true;
    } catch (e2) {
      // Ignore
    }
  }
  
  // Check proposal signers on both RPCs
  const [proposalPda] = getProposalPda({
    multisigPda: vaultPda,
    transactionIndex: BigInt(transactionIndex),
    programId: PROGRAM_ID,
  });
  
  let signerFound = false;
  let signersPrimary = [];
  let signersSecondary = [];
  
  try {
    const proposalPrimary = await accounts.Proposal.fromAccountAddress(connection, proposalPda, 'confirmed');
    if (proposalPrimary.signers) {
      signersPrimary = proposalPrimary.signers.map(s => s.toString());
      signerFound = proposalPrimary.signers.some(s => s.toString().toLowerCase() === wallet.toLowerCase());
    }
  } catch (e) {
    // Ignore
  }
  
  if (!signerFound) {
    try {
      const proposalSecondary = await accounts.Proposal.fromAccountAddress(fallbackConnection, proposalPda, 'confirmed');
      if (proposalSecondary.signers) {
        signersSecondary = proposalSecondary.signers.map(s => s.toString());
        signerFound = proposalSecondary.signers.some(s => s.toString().toLowerCase() === wallet.toLowerCase());
      }
    } catch (e) {
      // Ignore
    }
  }
  
  if (signerFound) {
    console.log(`✅ Signature found for ${matchId}`, {
      matchId,
      wallet,
      proposalId,
      txSig,
      signersPrimary,
      signersSecondary,
      txConfirmed,
    });
    
    // Update database
    await client.query(`
      UPDATE "match"
      SET "proposalStatus" = 'ACTIVE',
          "updatedAt" = NOW()
      WHERE id = $1
    `, [matchId]);
    
    return { ok: true, signersPrimary, signersSecondary, txConfirmed };
  } else {
    console.log(`❌ Signature still not found for ${matchId}`, {
      matchId,
      wallet,
      proposalId,
      txSig,
      signersPrimary,
      signersSecondary,
      txConfirmed,
    });
    return { ok: false, reason: 'signature_not_found', signersPrimary, signersSecondary, txConfirmed };
  }
}

async function main() {
  const matchId = process.argv[2];
  
  await client.connect();
  console.log('✅ Connected to database');
  
  let query;
  let params;
  
  if (matchId) {
    query = `
      SELECT id, "payoutProposalId", "proposalSigners", "proposalTransactionId", "squadsVaultAddress"
      FROM "match"
      WHERE id = $1
        AND "proposalStatus" = 'SIGNATURE_VERIFICATION_FAILED'
    `;
    params = [matchId];
  } else {
    query = `
      SELECT id, "payoutProposalId", "proposalSigners", "proposalTransactionId", "squadsVaultAddress"
      FROM "match"
      WHERE "proposalStatus" = 'SIGNATURE_VERIFICATION_FAILED'
        AND "updatedAt" > NOW() - INTERVAL '24 hours'
      ORDER BY "updatedAt" DESC
    `;
    params = [];
  }
  
  const result = await client.query(query, params);
  console.log(`Found ${result.rows.length} failed verifications to re-check`);
  
  for (const row of result.rows) {
    const matchId = row.id;
    const proposalId = row.payoutProposalId;
    const proposalSigners = row.proposalSigners || [];
    const txSig = row.proposalTransactionId;
    const vaultAddress = row.squadsVaultAddress;
    
    if (!proposalId || !txSig || !vaultAddress) {
      console.warn(`⚠️ Skipping ${matchId} - missing required fields`, {
        matchId,
        hasProposalId: !!proposalId,
        hasTxSig: !!txSig,
        hasVaultAddress: !!vaultAddress,
      });
      continue;
    }
    
    // Get wallet from proposalSigners (should be the last one that failed)
    const wallet = proposalSigners.length > 0 ? proposalSigners[proposalSigners.length - 1] : null;
    if (!wallet) {
      console.warn(`⚠️ Skipping ${matchId} - no wallet in proposalSigners`);
      continue;
    }
    
    console.log(`\n🔍 Re-checking verification for ${matchId}...`);
    const result = await recheckVerification(matchId, proposalId, wallet, txSig, vaultAddress);
    
    if (result.ok) {
      console.log(`✅ Verification succeeded for ${matchId} - database updated`);
    } else {
      console.log(`❌ Verification still failed for ${matchId}: ${result.reason}`);
    }
  }
  
  await client.end();
  console.log('\n✅ Re-check complete');
}

main().catch(console.error);


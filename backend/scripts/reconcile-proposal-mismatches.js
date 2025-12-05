#!/usr/bin/env node
/**
 * Reconciliation script to find and fix DB/on-chain mismatches for proposals.
 * 
 * This script:
 * 1. Finds proposals with signers in DB that aren't on-chain
 * 2. Marks them as UNCONFIRMED
 * 3. Provides recovery options
 * 
 * Usage: node reconcile-proposal-mismatches.js [--fix]
 *   --fix: Actually update the database (default is dry-run)
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts } = require('@sqds/multisig');
const { AppDataSource } = require('../src/db');
const { Match } = require('../src/models/Match');

const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'); // Devnet

async function reconcileMismatches(dryRun = true) {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    await AppDataSource.initialize();
    const matchRepository = AppDataSource.getRepository(Match);

    // Find suspicious proposals
    const suspiciousMatches = await matchRepository.query(`
      SELECT 
        id,
        "squadsVaultAddress",
        "payoutProposalId",
        "tieRefundProposalId",
        "proposalStatus",
        "proposalSigners",
        "needsSignatures",
        "proposalExecutedAt",
        "createdAt",
        "updatedAt"
      FROM "match"
      WHERE 
        ("proposalStatus" IN ('EXECUTING', 'ACTIVE', 'READY_TO_EXECUTE', 'APPROVED') OR "proposalStatus" IS NULL)
        AND ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
        AND "proposalSigners" IS NOT NULL
        AND "proposalExecutedAt" IS NULL
        AND "updatedAt" > NOW() - INTERVAL '7 days'
      ORDER BY "updatedAt" DESC
      LIMIT 50
    `);

    console.log(`\n🔍 Found ${suspiciousMatches.length} proposals to check\n`);

    const mismatches = [];
    const fixed = [];

    for (const match of suspiciousMatches) {
      const proposalId = match.payoutProposalId || match.tieRefundProposalId;
      if (!proposalId) continue;

      try {
        const proposalPda = new PublicKey(proposalId);
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          connection,
          proposalPda
        );

        const onChainSigners = Array.isArray(proposalAccount.approved)
          ? proposalAccount.approved.map(s => s.toString().toLowerCase())
          : [];

        const dbSigners = match.proposalSigners
          ? (typeof match.proposalSigners === 'string'
              ? JSON.parse(match.proposalSigners)
              : match.proposalSigners)
              .map(s => s.toString().toLowerCase())
          : [];

        const missingOnChain = dbSigners.filter(s => !onChainSigners.includes(s));
        const missingInDB = onChainSigners.filter(s => !dbSigners.includes(s));

        if (missingOnChain.length > 0 || missingInDB.length > 0) {
          const statusKind = proposalAccount.status?.__kind || 'Unknown';
          const threshold = proposalAccount.threshold ? Number(proposalAccount.threshold) : 'N/A';

          console.log(`\n📋 Match ID: ${match.id}`);
          console.log(`   Proposal: ${proposalId}`);
          console.log(`   DB Status: ${match.proposalStatus || 'NULL'}`);
          console.log(`   On-chain Status: ${statusKind}`);
          console.log(`   DB Signers: ${dbSigners.length} (${dbSigners.join(', ')})`);
          console.log(`   On-chain Signers: ${onChainSigners.length} (${onChainSigners.join(', ')})`);
          console.log(`   Threshold: ${threshold}`);

          if (missingOnChain.length > 0) {
            console.log(`   ❌ Missing on-chain: ${missingOnChain.join(', ')}`);
          }
          if (missingInDB.length > 0) {
            console.log(`   ⚠️ Missing in DB: ${missingInDB.join(', ')}`);
          }

          mismatches.push({
            matchId: match.id,
            proposalId,
            dbSigners,
            onChainSigners,
            missingOnChain,
            missingInDB,
            dbStatus: match.proposalStatus,
            onChainStatus: statusKind,
            needsSignatures: match.needsSignatures,
            threshold,
          });

          // Fix: Remove unconfirmed signers from DB
          if (!dryRun && missingOnChain.length > 0) {
            const confirmedSigners = dbSigners.filter(s => onChainSigners.includes(s));
            const confirmedSignersJson = JSON.stringify(confirmedSigners);
            
            // Recalculate needsSignatures based on on-chain state
            const actualNeedsSignatures = Math.max(0, threshold - onChainSigners.length);
            
            // Update status based on on-chain state
            let newStatus = match.proposalStatus;
            if (statusKind === 'ExecuteReady' || (statusKind === 'Approved' && onChainSigners.length >= threshold)) {
              newStatus = 'READY_TO_EXECUTE';
            } else if (statusKind === 'Approved' && onChainSigners.length < threshold) {
              newStatus = 'ACTIVE';
            } else if (statusKind === 'Active') {
              newStatus = 'ACTIVE';
            }

            await matchRepository.query(`
              UPDATE "match"
              SET 
                "proposalSigners" = $1,
                "needsSignatures" = $2,
                "proposalStatus" = $3,
                "updatedAt" = NOW()
              WHERE id = $4
            `, [confirmedSignersJson, actualNeedsSignatures, newStatus, match.id]);

            console.log(`   ✅ Fixed: Removed ${missingOnChain.length} unconfirmed signer(s) from DB`);
            console.log(`      New signers: ${confirmedSigners.join(', ')}`);
            console.log(`      New needsSignatures: ${actualNeedsSignatures}`);
            console.log(`      New status: ${newStatus}`);

            fixed.push({
              matchId: match.id,
              proposalId,
              removedSigners: missingOnChain,
              confirmedSigners,
              newNeedsSignatures: actualNeedsSignatures,
              newStatus,
            });
          }
        }
      } catch (error) {
        console.error(`❌ Error checking match ${match.id}:`, error.message);
      }
    }

    console.log(`\n\n📊 SUMMARY:`);
    console.log(`   Total checked: ${suspiciousMatches.length}`);
    console.log(`   Mismatches found: ${mismatches.length}`);
    if (!dryRun) {
      console.log(`   Fixed: ${fixed.length}`);
    } else {
      console.log(`   Run with --fix to apply corrections`);
    }

    if (mismatches.length > 0) {
      console.log(`\n⚠️ RECOMMENDATIONS:`);
      console.log(`   1. For matches with missing on-chain signers:`);
      console.log(`      - User must re-sign the proposal`);
      console.log(`      - Check if signed transaction was ever broadcast`);
      console.log(`   2. For matches with missing in DB signers:`);
      console.log(`      - Run with --fix to sync DB with on-chain state`);
    }

  } catch (error) {
    console.error('❌ Error during reconciliation:', error.message);
    console.error(error.stack);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

const args = process.argv.slice(2);
const dryRun = !args.includes('--fix');

if (dryRun) {
  console.log('🔍 DRY RUN MODE - No changes will be made\n');
} else {
  console.log('⚠️ FIX MODE - Database will be updated\n');
}

reconcileMismatches(dryRun).then(() => {
  console.log('\n✅ Reconciliation complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error during reconciliation:', error);
  process.exit(1);
});


// @ts-nocheck
/**
 * Sync Match Proposal Script
 * 
 * Syncs a specific match's proposal status from on-chain to database.
 * 
 * Usage:
 *   ts-node scripts/sync-match-proposal.ts <matchId>
 * 
 * Example:
 *   ts-node scripts/sync-match-proposal.ts a3fd6e93-fad9-47e9-8f3a-df676b4c422f
 */

import { AppDataSource } from '../src/db';
import { syncMatchProposal } from '../src/utils/proposalSync';

async function main() {
  const matchId = process.argv[2];
  
  if (!matchId) {
    console.error('❌ Usage: ts-node scripts/sync-match-proposal.ts <matchId>');
    process.exit(1);
  }

  try {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connection initialized');
    }

    // Get match from database to get vault address
    const matchRepository = AppDataSource.getRepository('Match');
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error(`❌ Match not found: ${matchId}`);
      process.exit(1);
    }

    const vaultAddress = (match as any).squadsVaultAddress;
    if (!vaultAddress) {
      console.error(`❌ Match has no vault address: ${matchId}`);
      process.exit(1);
    }

    console.log('🔄 Syncing proposal for match:', {
      matchId,
      vaultAddress,
      currentProposalId: (match as any).payoutProposalId,
      currentStatus: (match as any).proposalStatus,
    });

    // Sync proposal
    const result = await syncMatchProposal(matchId, vaultAddress);

    if (result.success && result.synced) {
      console.log('✅ Proposal synced successfully:', {
        matchId: result.matchId,
        changes: result.changes,
      });
    } else if (result.success && !result.synced) {
      console.log('ℹ️ Proposal already in sync:', {
        matchId: result.matchId,
        dbProposalId: result.dbProposalId,
        onChainProposalId: result.onChainProposalId,
      });
    } else {
      console.error('❌ Failed to sync proposal:', {
        matchId: result.matchId,
        error: result.error,
      });
      process.exit(1);
    }

    // Close database connection
    await AppDataSource.destroy();
    console.log('✅ Database connection closed');
    
  } catch (error: any) {
    console.error('❌ Error syncing proposal:', {
      matchId,
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  }
}

main();


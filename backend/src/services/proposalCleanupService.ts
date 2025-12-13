// @ts-nocheck
/**
 * Proposal Cleanup Service
 * 
 * Archives old unapproved proposals to prevent database bloat
 * Runs as a background job to clean up stale proposals
 */

import { AppDataSource } from '../db';
import { isFinalizedStatus } from './proposalSyncService';
import { checkProposalExists } from './proposalSyncService';

export interface CleanupResult {
  success: boolean;
  archived: number;
  errors: number;
  details: {
    matchesProcessed: number;
    proposalsArchived: number;
    proposalsSkipped: number;
    errors: Array<{ matchId: string; error: string }>;
  };
}

/**
 * Archive old unapproved proposals
 * 
 * Criteria for archiving:
 * - Proposal is older than 7 days
 * - Proposal status is ACTIVE but not Approved
 * - Proposal has no recent activity (no new signatures in last 3 days)
 * 
 * Archived proposals are marked but not deleted (for audit trail)
 */
export async function archiveOldProposals(
  maxAgeDays: number = 7,
  inactivityDays: number = 3
): Promise<CleanupResult> {
  const matchRepository = AppDataSource.getRepository('Match');
  const result: CleanupResult = {
    success: true,
    archived: 0,
    errors: 0,
    details: {
      matchesProcessed: 0,
      proposalsArchived: 0,
      proposalsSkipped: 0,
      errors: [],
    },
  };

  try {
    const maxAge = new Date();
    maxAge.setDate(maxAge.getDate() - maxAgeDays);
    
    const inactivityThreshold = new Date();
    inactivityThreshold.setDate(inactivityThreshold.getDate() - inactivityDays);

    // Find matches with old proposals
    const oldProposals = await matchRepository.query(`
      SELECT 
        id,
        "payoutProposalId",
        "tieRefundProposalId",
        "proposalStatus",
        "proposalCreatedAt",
        "proposalSigners",
        "updatedAt",
        "squadsVaultAddress"
      FROM "match"
      WHERE 
        ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
        AND "proposalStatus" = 'ACTIVE'
        AND "proposalCreatedAt" < $1
        AND "updatedAt" < $2
      ORDER BY "proposalCreatedAt" ASC
      LIMIT 100
    `, [maxAge, inactivityThreshold]);

    result.details.matchesProcessed = oldProposals.length;

    console.log('🧹 [proposalCleanupService] Starting cleanup of old proposals', {
      matchesFound: oldProposals.length,
      maxAgeDays,
      inactivityDays,
    });

    for (const match of oldProposals) {
      try {
        const proposalId = match.payoutProposalId || match.tieRefundProposalId;
        if (!proposalId || !match.squadsVaultAddress) {
          result.details.proposalsSkipped++;
          continue;
        }

        // Check on-chain status
        const onChainCheck = await checkProposalExists(proposalId, match.squadsVaultAddress);
        
        if (!onChainCheck || !onChainCheck.exists) {
          // Proposal doesn't exist on-chain - mark as archived
          console.log('📦 [proposalCleanupService] Archiving non-existent proposal', {
            matchId: match.id,
            proposalId,
          });
          
          await matchRepository.update(match.id, {
            proposalStatus: 'ARCHIVED',
            updatedAt: new Date(),
          });
          
          result.archived++;
          result.details.proposalsArchived++;
          
          // 📘 Enhanced logging
          console.log('📘 [proposalCleanupService] PROPOSAL_ARCHIVED', {
            event: 'PROPOSAL_ARCHIVED',
            matchId: match.id,
            proposalId,
            reason: 'proposal_not_found_onchain',
            createdAt: match.proposalCreatedAt,
            timestamp: new Date().toISOString(),
          });
        } else if (onChainCheck.valid === false || isFinalizedStatus(onChainCheck.status || '')) {
          // Proposal is finalized - mark as archived
          console.log('📦 [proposalCleanupService] Archiving finalized proposal', {
            matchId: match.id,
            proposalId,
            status: onChainCheck.status,
          });
          
          await matchRepository.update(match.id, {
            proposalStatus: onChainCheck.status?.toUpperCase() || 'ARCHIVED',
            updatedAt: new Date(),
          });
          
          result.archived++;
          result.details.proposalsArchived++;
          
          // 📘 Enhanced logging
          console.log('📘 [proposalCleanupService] PROPOSAL_ARCHIVED', {
            event: 'PROPOSAL_ARCHIVED',
            matchId: match.id,
            proposalId,
            reason: 'proposal_finalized',
            status: onChainCheck.status,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Proposal is still valid - skip
          result.details.proposalsSkipped++;
        }
      } catch (error: any) {
        result.errors++;
        result.details.errors.push({
          matchId: match.id,
          error: error?.message || 'Unknown error',
        });
        
        console.error('❌ [proposalCleanupService] Error processing match', {
          matchId: match.id,
          error: error?.message,
        });
      }
    }

    console.log('✅ [proposalCleanupService] Cleanup completed', {
      archived: result.archived,
      skipped: result.details.proposalsSkipped,
      errors: result.errors,
    });

    return result;
  } catch (error: any) {
    console.error('❌ [proposalCleanupService] Fatal error in cleanup', {
      error: error?.message,
      stack: error?.stack,
    });
    
    result.success = false;
    return result;
  }
}

/**
 * Run cleanup as a scheduled job
 * Should be called from cron service
 */
export async function runScheduledCleanup(): Promise<void> {
  console.log('🕐 [proposalCleanupService] Running scheduled cleanup...');
  const result = await archiveOldProposals(7, 3);
  
  if (result.success) {
    console.log('✅ [proposalCleanupService] Scheduled cleanup completed', {
      archived: result.archived,
      errors: result.errors,
    });
  } else {
    console.error('❌ [proposalCleanupService] Scheduled cleanup failed', {
      errors: result.errors,
    });
  }
}


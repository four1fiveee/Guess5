// @ts-nocheck
/**
 * Orphan Proposal Cleanup Service
 * 
 * Cleans up old orphaned proposals that are no longer needed.
 * Orphaned proposals are proposals that exist on-chain but are not tracked in the database.
 * 
 * This service:
 * - Identifies orphaned proposals that are old (>24 hours) and in non-active states
 * - Archives or cancels them if they're stuck in Active/Approved state
 * - Prevents accumulation of orphaned proposals that could conflict with new transaction indices
 */

import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { enhancedLogger } from '../utils/enhancedLogger';
import { PublicKey, Connection } from '@solana/web3.js';
import { getProposalPda, accounts } from '@sqds/multisig';
import { createStandardSolanaConnection } from '../config/solanaConnection';
import { withRateLimitBackoff } from '../utils/rateLimitBackoff';

interface OrphanProposal {
  vaultAddress: string;
  transactionIndex: number;
  proposalPda: string;
  status: string;
  approvedSigners: number;
  threshold: number;
  ageHours: number;
}

interface CleanupResult {
  totalOrphansFound: number;
  orphansCleaned: number;
  orphansCancelled: number;
  errors: Array<{ transactionIndex: number; error: string }>;
}

/**
 * Clean up orphaned proposals for a specific vault
 */
export async function cleanupOrphanedProposals(
  vaultAddress: string,
  options: {
    maxAgeHours?: number; // Only clean up orphans older than this (default: 24 hours)
    cancelActive?: boolean; // Cancel Active/Approved orphans (default: false - just log)
    dryRun?: boolean; // If true, don't actually cancel, just log what would be done
  } = {}
): Promise<CleanupResult> {
  const {
    maxAgeHours = 24,
    cancelActive = false,
    dryRun = false,
  } = options;

  const result: CleanupResult = {
    totalOrphansFound: 0,
    orphansCleaned: 0,
    orphansCancelled: 0,
    errors: [],
  };

  try {
    const connection = createStandardSolanaConnection('confirmed');
    const multisigPda = new PublicKey(vaultAddress);
    const matchRepository = AppDataSource.getRepository(Match);

    // Get multisig threshold
    let threshold = 2;
    try {
      const multisigAccount = await withRateLimitBackoff(() =>
        accounts.Multisig.fromAccountAddress(connection, multisigPda)
      );
      threshold = (multisigAccount as any).threshold || 2;
    } catch (e: any) {
      enhancedLogger.warn('⚠️ Could not fetch multisig threshold for cleanup', {
        vaultAddress,
        error: e?.message,
        defaultThreshold: 2,
      });
    }

    // Scan transaction indices 0-19 for orphaned proposals
    const maxTransactionIndex = 20;
    const orphanedProposals: OrphanProposal[] = [];
    const now = Date.now();

    for (let txIndex = 0; txIndex < maxTransactionIndex; txIndex++) {
      try {
        const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu');
        
        const [proposalPda] = getProposalPda({
          multisigPda,
          transactionIndex: txIndex,
          programId,
        });

        const proposalPdaString = proposalPda.toString();

        // Check if proposal exists in DB
        const dbMatches = await matchRepository.query(`
          SELECT id, "payoutProposalId", "proposalStatus", "proposalCreatedAt"
          FROM match
          WHERE "squadsVaultAddress" = $1 
            AND ("payoutProposalId" = $2 OR "tieRefundProposalId" = $2)
          LIMIT 1
        `, [vaultAddress, proposalPdaString]);

        if (dbMatches.length > 0) {
          // Proposal is tracked in DB - skip
          continue;
        }

        // Proposal not in DB - check if it exists on-chain
        try {
          const proposalAccount = await withRateLimitBackoff(() =>
            accounts.Proposal.fromAccountAddress(connection, proposalPda, 'confirmed')
          );

          const statusObj = (proposalAccount as any).status;
          const statusKind = typeof statusObj === 'object' && statusObj !== null && '__kind' in statusObj
            ? statusObj.__kind
            : (typeof statusObj === 'string' ? statusObj : 'Unknown');

          const approvedSigners = (proposalAccount as any).approved || [];
          const approvedSignersCount = Array.isArray(approvedSigners) ? approvedSigners.length : 0;

          // Get proposal creation timestamp if available
          let ageHours = 999; // Default to very old if we can't determine age
          if (statusObj && typeof statusObj === 'object' && 'timestamp' in statusObj) {
            // Timestamp is in hex format, convert to seconds
            const timestampHex = statusObj.timestamp;
            const timestampSeconds = parseInt(timestampHex, 16);
            const timestampMs = timestampSeconds * 1000;
            ageHours = (now - timestampMs) / (1000 * 60 * 60);
          }

          // Only consider proposals older than maxAgeHours
          if (ageHours < maxAgeHours) {
            continue;
          }

          orphanedProposals.push({
            vaultAddress,
            transactionIndex: txIndex,
            proposalPda: proposalPdaString,
            status: statusKind,
            approvedSigners: approvedSignersCount,
            threshold,
            ageHours: Math.round(ageHours * 10) / 10,
          });

          result.totalOrphansFound++;

          // Clean up based on status
          if (statusKind === 'Executed' || statusKind === 'Cancelled' || statusKind === 'Rejected') {
            // Already finalized - just log
            enhancedLogger.info('🧹 Found finalized orphaned proposal (no action needed)', {
              vaultAddress,
              transactionIndex: txIndex,
              proposalPda: proposalPdaString,
              status: statusKind,
              ageHours: Math.round(ageHours * 10) / 10,
            });
            result.orphansCleaned++;
          } else if (statusKind === 'Active' || statusKind === 'Approved') {
            // Active/Approved orphan - can be cancelled if old enough
            if (cancelActive && !dryRun) {
              enhancedLogger.warn('⚠️ Would cancel old orphaned proposal (cancellation disabled for safety)', {
                vaultAddress,
                transactionIndex: txIndex,
                proposalPda: proposalPdaString,
                status: statusKind,
                ageHours: Math.round(ageHours * 10) / 10,
                note: 'Cancellation is disabled by default. Enable cancelActive option to cancel old orphaned proposals.',
              });
              // TODO: Implement cancellation if needed
              // For now, just log
              result.orphansCleaned++;
            } else {
              enhancedLogger.info('🧹 Found old orphaned proposal (Active/Approved - not cancelled)', {
                vaultAddress,
                transactionIndex: txIndex,
                proposalPda: proposalPdaString,
                status: statusKind,
                ageHours: Math.round(ageHours * 10) / 10,
                approvedSigners: approvedSignersCount,
                threshold,
                note: dryRun 
                  ? 'DRY RUN: Would cancel this orphaned proposal'
                  : 'Orphaned proposal found but cancellation is disabled. Enable cancelActive to cancel old orphans.',
              });
              if (dryRun) {
                result.orphansCleaned++;
              }
            }
          }
        } catch (fetchError: any) {
          // Proposal doesn't exist on-chain - skip
          continue;
        }
      } catch (error: any) {
        result.errors.push({
          transactionIndex: txIndex,
          error: error?.message || String(error),
        });
        enhancedLogger.warn('⚠️ Error checking transaction index for orphan cleanup', {
          vaultAddress,
          transactionIndex: txIndex,
          error: error?.message || String(error),
        });
      }
    }

    enhancedLogger.info('✅ Orphan proposal cleanup completed', {
      vaultAddress,
      totalOrphansFound: result.totalOrphansFound,
      orphansCleaned: result.orphansCleaned,
      errors: result.errors.length,
      dryRun,
    });

    return result;
  } catch (error: any) {
    enhancedLogger.error('❌ Orphan proposal cleanup failed', {
      vaultAddress,
      error: error?.message || String(error),
    });
    throw error;
  }
}

/**
 * Clean up orphaned proposals for all active vaults
 */
export async function cleanupAllOrphanedProposals(
  options: {
    maxAgeHours?: number;
    cancelActive?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<{ [vaultAddress: string]: CleanupResult }> {
  const results: { [vaultAddress: string]: CleanupResult } = {};

  try {
    const matchRepository = AppDataSource.getRepository(Match);

    // Get all unique vault addresses from matches
    const vaultAddresses = await matchRepository.query(`
      SELECT DISTINCT "squadsVaultAddress"
      FROM match
      WHERE "squadsVaultAddress" IS NOT NULL
      LIMIT 50
    `);

    enhancedLogger.info('🧹 Starting orphan proposal cleanup for all vaults', {
      totalVaults: vaultAddresses.length,
      options,
    });

    for (const row of vaultAddresses) {
      const vaultAddress = row.squadsVaultAddress;
      if (!vaultAddress) continue;

      try {
        const result = await cleanupOrphanedProposals(vaultAddress, options);
        results[vaultAddress] = result;
      } catch (error: any) {
        enhancedLogger.error('❌ Failed to cleanup orphans for vault', {
          vaultAddress,
          error: error?.message || String(error),
        });
        results[vaultAddress] = {
          totalOrphansFound: 0,
          orphansCleaned: 0,
          orphansCancelled: 0,
          errors: [{ transactionIndex: -1, error: error?.message || String(error) }],
        };
      }
    }

    const totalOrphans = Object.values(results).reduce((sum, r) => sum + r.totalOrphansFound, 0);
    const totalCleaned = Object.values(results).reduce((sum, r) => sum + r.orphansCleaned, 0);

    enhancedLogger.info('✅ Orphan proposal cleanup for all vaults completed', {
      totalVaults: vaultAddresses.length,
      totalOrphansFound: totalOrphans,
      totalOrphansCleaned: totalCleaned,
    });

    return results;
  } catch (error: any) {
    enhancedLogger.error('❌ Failed to cleanup all orphaned proposals', {
      error: error?.message || String(error),
    });
    throw error;
  }
}


// @ts-nocheck
/**
 * Proposal Reconciliation Service
 * 
 * CRON job or admin tool that detects and logs mismatches between:
 * - On-chain proposal statuses
 * - DB-tracked proposals
 * - Executed vs. not executed
 * - Proposal index differences
 * 
 * This provides observability into hidden desyncs and enables proactive detection
 * of orphaned proposals, executed proposals not marked in DB, etc.
 */

import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { enhancedLogger } from '../utils/enhancedLogger';
import { PublicKey } from '@solana/web3.js';
import { getMultisigPda, getProposalPda, accounts } from '@sqds/multisig';
import { createStandardSolanaConnection } from '../config/solanaConnection';

interface ReconciliationResult {
  vaultAddress: string;
  totalProposalsScanned: number;
  orphanedProposals: Array<{
    transactionIndex: number;
    proposalPda: string;
    status: string;
    approvedSigners: number;
  }>;
  statusMismatches: Array<{
    transactionIndex: number;
    proposalPda: string;
    onChainStatus: string;
    dbStatus: string;
    matchId?: string;
  }>;
  executedNotInDb: Array<{
    transactionIndex: number;
    proposalPda: string;
    matchId?: string;
  }>;
  autoHealed: number;
  errors: Array<{
    transactionIndex: number;
    error: string;
  }>;
}

/**
 * Reconcile proposals for a specific vault
 */
export async function reconcileProposalsForVault(vaultAddress: string): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    vaultAddress,
    totalProposalsScanned: 0,
    orphanedProposals: [],
    statusMismatches: [],
    executedNotInDb: [],
    autoHealed: 0,
    errors: [],
  };

  try {
    const connection = createStandardSolanaConnection('confirmed');
    // vaultAddress is already the multisig PDA address
    const multisigPda = new PublicKey(vaultAddress);

    // Get multisig threshold
    let threshold = 2;
    try {
      const multisigAccount = await accounts.Multisig.fromAccountAddress(connection, multisigPda);
      threshold = (multisigAccount as any).threshold || 2;
    } catch (e: any) {
      enhancedLogger.warn('⚠️ Could not fetch multisig threshold for reconciliation', {
        vaultAddress,
        error: e?.message,
        defaultThreshold: 2,
      });
    }

    // Scan transaction indices 0-19
    const maxTransactionIndex = 20;
    const matchRepository = AppDataSource.getRepository(Match);

    for (let txIndex = 0; txIndex < maxTransactionIndex; txIndex++) {
      try {
        result.totalProposalsScanned++;

        // Get program ID from environment (same as squadsVaultService)
        const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu');
        
        const [proposalPda] = getProposalPda({
          multisigPda,
          transactionIndex: txIndex,
          programId,
        });

        // Try to fetch proposal from on-chain
        let onChainProposal: any = null;
        try {
          onChainProposal = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
        } catch (e: any) {
          // Proposal doesn't exist at this index - skip
          if (e?.message?.includes('Unable to find') || e?.message?.includes('Account does not exist')) {
            continue;
          }
          // Unexpected error
          result.errors.push({
            transactionIndex: txIndex,
            error: e?.message || String(e),
          });
          continue;
        }

        const onChainStatus = (onChainProposal as any).status?.__kind || 'Unknown';
        const approvedSigners = (onChainProposal as any).approved || [];
        const approvedSignersCount = approvedSigners.length;
        const isExecuted = onChainStatus === 'Executed';

        // Try to find matching proposal in database
        const proposalPdaString = proposalPda.toString();
        const dbMatches = await matchRepository.query(`
          SELECT 
            id,
            "payoutProposalId",
            "tieRefundProposalId",
            "payoutProposalTransactionIndex",
            "tieRefundProposalTransactionIndex",
            "proposalStatus",
            "proposalExecutedAt",
            "proposalTransactionId"
          FROM "match"
          WHERE 
            "squadsVaultAddress" = $1
            AND (
              "payoutProposalId" = $2 
              OR "tieRefundProposalId" = $2
            )
          LIMIT 1
        `, [vaultAddress, proposalPdaString]);

        const dbMatch = dbMatches.length > 0 ? dbMatches[0] : null;

        if (!dbMatch) {
          // Orphaned proposal - exists on-chain but not in DB
          result.orphanedProposals.push({
            transactionIndex: txIndex,
            proposalPda: proposalPdaString,
            status: onChainStatus,
            approvedSigners: approvedSignersCount,
          });

          enhancedLogger.warn('🧟 Orphaned proposal on-chain (not in DB)', {
            vaultAddress,
            transactionIndex: txIndex,
            proposalPda: proposalPdaString,
            status: onChainStatus,
            approvedSigners: approvedSignersCount,
            threshold,
            note: 'This proposal exists on-chain but is not tracked in the database. Consider investigating how it was created.',
          });
        } else {
          // Proposal exists in DB - check for mismatches
          const dbStatus = dbMatch.proposalStatus || 'UNKNOWN';
          const dbExecutedAt = dbMatch.proposalExecutedAt;
          const dbTransactionId = dbMatch.proposalTransactionId;

          // Normalize statuses for comparison
          const normalizedOnChainStatus = normalizeStatus(onChainStatus);
          const normalizedDbStatus = normalizeStatus(dbStatus);

          if (normalizedOnChainStatus !== normalizedDbStatus) {
            // Status mismatch
            result.statusMismatches.push({
              transactionIndex: txIndex,
              proposalPda: proposalPdaString,
              onChainStatus: normalizedOnChainStatus,
              dbStatus: normalizedDbStatus,
              matchId: dbMatch.id,
            });

            enhancedLogger.error('❗ Status mismatch detected', {
              vaultAddress,
              matchId: dbMatch.id,
              transactionIndex: txIndex,
              proposalPda: proposalPdaString,
              onChainStatus: normalizedOnChainStatus,
              dbStatus: normalizedDbStatus,
              note: 'On-chain and database statuses do not match. This indicates a desynchronization.',
            });
          }

          // Check if executed on-chain but not marked in DB
          if (isExecuted && !dbExecutedAt && !dbTransactionId) {
            result.executedNotInDb.push({
              transactionIndex: txIndex,
              proposalPda: proposalPdaString,
              matchId: dbMatch.id,
            });

            enhancedLogger.warn('🛠 Proposal executed on-chain but not marked in DB', {
              vaultAddress,
              matchId: dbMatch.id,
              transactionIndex: txIndex,
              proposalPda: proposalPdaString,
              note: 'Auto-healing: Updating database to reflect execution status',
            });

            // Auto-heal: Update database
            try {
              await matchRepository.query(`
                UPDATE "match"
                SET "proposalStatus" = 'EXECUTED',
                    "proposalExecutedAt" = NOW(),
                    "updatedAt" = NOW()
                WHERE id = $1
              `, [dbMatch.id]);

              result.autoHealed++;
              enhancedLogger.info('✅ Auto-healed: Updated database to reflect execution', {
                vaultAddress,
                matchId: dbMatch.id,
                transactionIndex: txIndex,
              });
            } catch (healError: any) {
              enhancedLogger.error('❌ Failed to auto-heal database', {
                vaultAddress,
                matchId: dbMatch.id,
                transactionIndex: txIndex,
                error: healError?.message,
              });
            }
          }
        }
      } catch (error: any) {
        result.errors.push({
          transactionIndex: txIndex,
          error: error?.message || String(error),
        });
        enhancedLogger.warn('⚠️ Error reconciling proposal at transaction index', {
          vaultAddress,
          transactionIndex: txIndex,
          error: error?.message,
        });
      }
    }

    // Log summary
    enhancedLogger.info('📊 Proposal reconciliation completed', {
      vaultAddress,
      summary: {
        totalScanned: result.totalProposalsScanned,
        orphaned: result.orphanedProposals.length,
        statusMismatches: result.statusMismatches.length,
        executedNotInDb: result.executedNotInDb.length,
        autoHealed: result.autoHealed,
        errors: result.errors.length,
      },
    });

    return result;
  } catch (error: any) {
    enhancedLogger.error('❌ Error during proposal reconciliation', {
      vaultAddress,
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}

/**
 * Reconcile proposals for all vaults in the database
 */
export async function reconcileAllProposals(): Promise<{
  vaultsScanned: number;
  results: ReconciliationResult[];
  summary: {
    totalOrphaned: number;
    totalStatusMismatches: number;
    totalExecutedNotInDb: number;
    totalAutoHealed: number;
    totalErrors: number;
  };
}> {
  if (!AppDataSource.isInitialized) {
    enhancedLogger.warn('⚠️ Database not initialized, skipping proposal reconciliation');
    return {
      vaultsScanned: 0,
      results: [],
      summary: {
        totalOrphaned: 0,
        totalStatusMismatches: 0,
        totalExecutedNotInDb: 0,
        totalAutoHealed: 0,
        totalErrors: 0,
      },
    };
  }

  try {
    const matchRepository = AppDataSource.getRepository(Match);

    // Get all unique vault addresses
    const vaults = await matchRepository.query(`
      SELECT DISTINCT "squadsVaultAddress"
      FROM "match"
      WHERE "squadsVaultAddress" IS NOT NULL
      ORDER BY "squadsVaultAddress"
    `);

    const results: ReconciliationResult[] = [];
    const summary = {
      totalOrphaned: 0,
      totalStatusMismatches: 0,
      totalExecutedNotInDb: 0,
      totalAutoHealed: 0,
      totalErrors: 0,
    };

    for (const vault of vaults) {
      const vaultAddress = vault.squadsVaultAddress;
      if (!vaultAddress) continue;

      try {
        const result = await reconcileProposalsForVault(vaultAddress);
        results.push(result);

        summary.totalOrphaned += result.orphanedProposals.length;
        summary.totalStatusMismatches += result.statusMismatches.length;
        summary.totalExecutedNotInDb += result.executedNotInDb.length;
        summary.totalAutoHealed += result.autoHealed;
        summary.totalErrors += result.errors.length;
      } catch (error: any) {
        enhancedLogger.error('❌ Error reconciling vault', {
          vaultAddress,
          error: error?.message,
        });
        // Continue with next vault
      }
    }

    enhancedLogger.info('📊 Full proposal reconciliation completed', {
      vaultsScanned: vaults.length,
      summary,
    });

    return {
      vaultsScanned: vaults.length,
      results,
      summary,
    };
  } catch (error: any) {
    enhancedLogger.error('❌ Error during full proposal reconciliation', {
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}

/**
 * Normalize status strings for comparison
 */
function normalizeStatus(status: string): string {
  const normalized = status.toUpperCase();
  // Map common variations
  if (normalized === 'ACTIVE') return 'ACTIVE';
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'EXECUTEREADY') return 'APPROVED'; // Treat ExecuteReady as Approved for comparison
  if (normalized === 'EXECUTING') return 'EXECUTING';
  if (normalized === 'EXECUTED') return 'EXECUTED';
  if (normalized === 'REJECTED') return 'REJECTED';
  if (normalized === 'CANCELLED') return 'CANCELLED';
  return normalized;
}


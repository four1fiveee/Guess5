/**
 * Background Reconciliation Worker
 * 
 * Runs every 5 minutes to:
 * - Scan DB for proposals in EXECUTING > 5 mins
 * - Compare against on-chain state
 * - Auto-fix mismatches
 * - Auto-execute if possible
 * - Mark failed proposals as ERROR
 * 
 * Pattern used by Drift, Tribeca, and Jupiter governance executors
 */

import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getSquadsVaultService } from './squadsVaultService';
import { getFeeWalletKeypair } from '../config/wallet';
import { normalizeProposalSigners } from '../utils/proposalHelpers';

const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface ReconciliationResult {
  matchId: string;
  proposalId: string;
  status: 'fixed' | 'executed' | 'error' | 'no_action';
  action?: string;
  error?: string;
}

/**
 * Reconcile a single match
 */
async function reconcileMatch(match: any): Promise<ReconciliationResult> {
  const matchId = match.id;
  const proposalId = match.payoutProposalId || match.tieRefundProposalId;
  const proposalStatus = match.proposalStatus;
  const vaultAddress = match.squadsVaultAddress;
  const executionAttempts = match.executionAttempts || 0;
  const executionLastAttemptAt = match.executionLastAttemptAt 
    ? new Date(match.executionLastAttemptAt) 
    : null;
  const updatedAt = match.updatedAt ? new Date(match.updatedAt) : null;

  // Check if proposal is stuck
  const now = new Date();
  const ageMs = updatedAt ? (now.getTime() - updatedAt.getTime()) : 0;
  const isStuck = (proposalStatus === 'EXECUTING' || proposalStatus === 'READY_TO_EXECUTE') && 
                  ageMs > STUCK_THRESHOLD_MS &&
                  !match.proposalExecutedAt;

  if (!isStuck) {
    return {
      matchId,
      proposalId: proposalId || 'unknown',
      status: 'no_action',
    };
  }

  enhancedLogger.info('🔍 Reconciling stuck proposal', {
    matchId,
    proposalId,
    proposalStatus,
    ageMinutes: Math.floor(ageMs / 60000),
    executionAttempts,
    executionLastAttemptAt: executionLastAttemptAt?.toISOString(),
  });

  try {
    const squadsVaultService = getSquadsVaultService();
    
    // Check on-chain state
    if (!vaultAddress || !proposalId) {
      enhancedLogger.warn('⚠️ Missing vault address or proposal ID for reconciliation', {
        matchId,
        vaultAddress,
        proposalId,
      });
      return {
        matchId,
        proposalId: proposalId || 'unknown',
        status: 'error',
        error: 'Missing vault address or proposal ID',
      };
    }

    const onChainStatus = await squadsVaultService.checkProposalStatus(vaultAddress, proposalId);
    
    if (!onChainStatus) {
      enhancedLogger.warn('⚠️ Could not fetch on-chain proposal status', {
        matchId,
        proposalId,
      });
      return {
        matchId,
        proposalId,
        status: 'error',
        error: 'Could not fetch on-chain status',
      };
    }

    // Check if proposal is actually executed on-chain
    if (onChainStatus.executed) {
      enhancedLogger.info('✅ Proposal is executed on-chain but DB shows EXECUTING - fixing mismatch', {
        matchId,
        proposalId,
        onChainExecuted: true,
        dbStatus: proposalStatus,
      });

      // Update database to match on-chain state
      const matchRepository = AppDataSource.getRepository(Match);
      await matchRepository.query(`
        UPDATE "match"
        SET "proposalStatus" = 'EXECUTED',
            "proposalExecutedAt" = COALESCE("proposalExecutedAt", NOW()),
            "updatedAt" = NOW()
        WHERE id = $1
      `, [matchId]);

      return {
        matchId,
        proposalId,
        status: 'fixed',
        action: 'Updated DB to match on-chain EXECUTED state',
      };
    }

    // Check if proposal is ready to execute on-chain
    if (onChainStatus.needsSignatures === 0 && !onChainStatus.executed) {
      enhancedLogger.info('🚀 Proposal is ready to execute on-chain - attempting execution', {
        matchId,
        proposalId,
        onChainNeedsSignatures: onChainStatus.needsSignatures,
        executionAttempts,
      });

      // Check if we've tried too many times (prevent infinite loops)
      if (executionAttempts >= 10) {
        enhancedLogger.error('❌ Proposal has exceeded max execution attempts - marking as ERROR', {
          matchId,
          proposalId,
          executionAttempts,
        });

        const matchRepository = AppDataSource.getRepository(Match);
        await matchRepository.query(`
          UPDATE "match"
          SET "proposalStatus" = 'ERROR',
              "updatedAt" = NOW()
          WHERE id = $1
        `, [matchId]);

        return {
          matchId,
          proposalId,
          status: 'error',
          action: 'Marked as ERROR - exceeded max execution attempts',
        };
      }

      // Attempt execution
      try {
        const feeWalletKeypair = getFeeWalletKeypair();
        const executeResult = await squadsVaultService.executeProposal(
          vaultAddress,
          proposalId,
          feeWalletKeypair,
          match.squadsVaultPda ?? undefined
        );

        if (executeResult.success) {
          enhancedLogger.info('✅ Reconciliation worker executed proposal successfully', {
            matchId,
            proposalId,
            signature: executeResult.signature,
            executionAttempts: executionAttempts + 1,
          });

          return {
            matchId,
            proposalId,
            status: 'executed',
            action: `Executed successfully - signature: ${executeResult.signature}`,
          };
        } else {
          enhancedLogger.warn('⚠️ Reconciliation worker execution attempt failed', {
            matchId,
            proposalId,
            error: executeResult.error,
            executionAttempts: executionAttempts + 1,
          });

          return {
            matchId,
            proposalId,
            status: 'error',
            error: executeResult.error || 'Execution failed',
          };
        }
      } catch (execError: any) {
        enhancedLogger.error('❌ Reconciliation worker execution error', {
          matchId,
          proposalId,
          error: execError?.message || String(execError),
        });

        return {
          matchId,
          proposalId,
          status: 'error',
          error: execError?.message || String(execError),
        };
      }
    }

    // Proposal still needs signatures or is in an unexpected state
    enhancedLogger.info('ℹ️ Proposal reconciliation - no action needed', {
      matchId,
      proposalId,
      onChainNeedsSignatures: onChainStatus.needsSignatures,
      onChainExecuted: onChainStatus.executed,
      dbStatus: proposalStatus,
    });

    return {
      matchId,
      proposalId,
      status: 'no_action',
      action: 'Proposal still needs signatures or is in expected state',
    };
  } catch (error: any) {
    enhancedLogger.error('❌ Error during reconciliation', {
      matchId,
      proposalId,
      error: error?.message || String(error),
    });

    return {
      matchId,
      proposalId: proposalId || 'unknown',
      status: 'error',
      error: error?.message || String(error),
    };
  }
}

/**
 * Run reconciliation for all stuck proposals
 */
async function runReconciliation(): Promise<void> {
  const correlationId = `reconciliation-${Date.now()}`;
  
  enhancedLogger.info('🔄 Starting reconciliation worker', {
    correlationId,
    interval: `${RECONCILIATION_INTERVAL_MS / 1000}s`,
  });

  try {
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find all stuck proposals (EXECUTING or READY_TO_EXECUTE for > 5 minutes, not executed)
    const stuckMatches = await matchRepository.query(`
      SELECT id, "payoutProposalId", "tieRefundProposalId", "proposalStatus",
             "squadsVaultAddress", "proposalExecutedAt", "updatedAt",
             "executionAttempts", "executionLastAttemptAt"
      FROM "match"
      WHERE ("proposalStatus" = 'EXECUTING' OR "proposalStatus" = 'READY_TO_EXECUTE')
        AND "proposalExecutedAt" IS NULL
        AND "updatedAt" < NOW() - INTERVAL '5 minutes'
        AND ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
        AND "squadsVaultAddress" IS NOT NULL
      ORDER BY "updatedAt" ASC
      LIMIT 50
    `);

    enhancedLogger.info('📊 Found stuck proposals for reconciliation', {
      correlationId,
      count: stuckMatches.length,
    });

    const results: ReconciliationResult[] = [];
    
    for (const match of stuckMatches) {
      try {
        const result = await reconcileMatch(match);
        results.push(result);
      } catch (matchError: any) {
        enhancedLogger.error('❌ Error reconciling individual match', {
          correlationId,
          matchId: match.id,
          error: matchError?.message || String(matchError),
        });
        
        results.push({
          matchId: match.id,
          proposalId: match.payoutProposalId || match.tieRefundProposalId || 'unknown',
          status: 'error',
          error: matchError?.message || String(matchError),
        });
      }
    }

    // Log summary
    const summary = {
      total: results.length,
      fixed: results.filter(r => r.status === 'fixed').length,
      executed: results.filter(r => r.status === 'executed').length,
      errors: results.filter(r => r.status === 'error').length,
      noAction: results.filter(r => r.status === 'no_action').length,
    };

    enhancedLogger.info('✅ Reconciliation worker completed', {
      correlationId,
      summary,
    });
  } catch (error: any) {
    enhancedLogger.error('❌ Reconciliation worker error', {
      correlationId,
      error: error?.message || String(error),
      stack: error?.stack,
    });
  }
}

/**
 * Start the reconciliation worker
 */
export function startReconciliationWorker(): void {
  enhancedLogger.info('🚀 Starting background reconciliation worker', {
    interval: `${RECONCILIATION_INTERVAL_MS / 1000}s`,
    stuckThreshold: `${STUCK_THRESHOLD_MS / 1000}s`,
  });

  // Run immediately on startup
  runReconciliation().catch((error: any) => {
    enhancedLogger.error('❌ Initial reconciliation run failed', {
      error: error?.message || String(error),
    });
  });

  // Then run every 5 minutes
  setInterval(() => {
    runReconciliation().catch((error: any) => {
      enhancedLogger.error('❌ Scheduled reconciliation run failed', {
        error: error?.message || String(error),
      });
    });
  }, RECONCILIATION_INTERVAL_MS);
}


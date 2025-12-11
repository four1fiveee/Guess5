// @ts-nocheck
/**
 * Proposal Execution Monitor
 * 
 * Background worker that periodically scans for proposals in Approved state
 * and automatically executes them when they become ExecuteReady on-chain.
 * 
 * This closes the automation gap for proposals that are Approved but not executed.
 */

import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { getSquadsVaultService } from './squadsVaultService';
import { getFeeWalletKeypair } from '../config/wallet';
import { enhancedLogger } from '../utils/enhancedLogger';

interface ExecutionAttempt {
  matchId: string;
  proposalId: string;
  attemptCount: number;
  lastAttempt: Date;
  nextRetry: Date;
}

// Track execution attempts to prevent spam
const executionAttempts = new Map<string, ExecutionAttempt>();

// Metrics tracking
interface MonitorMetrics {
  proposalsChecked: number;
  proposalsExecuted: number;
  proposalsSkippedAwaitingReady: number;
  proposalsSkippedOther: number;
  proposalsAlreadyExecuted: number;
  executionErrors: number;
  lastScanTime: Date | null;
}

const metrics: MonitorMetrics = {
  proposalsChecked: 0,
  proposalsExecuted: 0,
  proposalsSkippedAwaitingReady: 0,
  proposalsSkippedOther: 0,
  proposalsAlreadyExecuted: 0,
  executionErrors: 0,
  lastScanTime: null,
};

// Configuration
const SCAN_INTERVAL_MS = 60000; // Scan every 60 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 30000; // 30 seconds between retries
const MAX_AGE_MINUTES = 30; // Only process proposals updated in last 30 minutes

let monitorInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Start the proposal execution monitor
 */
export function startProposalExecutionMonitor(): void {
  if (isRunning) {
    enhancedLogger.warn('⚠️ Proposal execution monitor is already running');
    return;
  }

  enhancedLogger.info('🚀 Starting proposal execution monitor', {
    scanInterval: `${SCAN_INTERVAL_MS / 1000}s`,
    maxRetries: MAX_RETRY_ATTEMPTS,
    retryBackoff: `${RETRY_BACKOFF_MS / 1000}s`,
    maxAge: `${MAX_AGE_MINUTES} minutes`,
  });

  isRunning = true;

  // Run immediately on start, then on interval
  scanAndExecuteProposals().catch((error) => {
    enhancedLogger.error('❌ Error in initial proposal execution scan:', error);
  });

  monitorInterval = setInterval(() => {
    scanAndExecuteProposals().catch((error) => {
      enhancedLogger.error('❌ Error in proposal execution scan:', error);
    });
  }, SCAN_INTERVAL_MS);
}

/**
 * Stop the proposal execution monitor
 */
export function stopProposalExecutionMonitor(): void {
  if (!isRunning) {
    return;
  }

  enhancedLogger.info('🛑 Stopping proposal execution monitor');

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }

  isRunning = false;
  executionAttempts.clear();
}

/**
 * Scan for Approved proposals and execute them if ExecuteReady
 */
async function scanAndExecuteProposals(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    enhancedLogger.warn('⚠️ Database not initialized, skipping proposal execution scan');
    return;
  }

  try {
    const matchRepository = AppDataSource.getRepository(Match);

    // Find matches with Approved proposals that haven't been executed
    const approvedMatches = await matchRepository.query(`
      SELECT 
        id,
        "squadsVaultAddress",
        "squadsVaultPda",
        "payoutProposalId",
        "tieRefundProposalId",
        "proposalStatus",
        "proposalExecutedAt",
        "proposalTransactionId",
        winner,
        "updatedAt"
      FROM "match"
      WHERE 
        "proposalStatus" = 'APPROVED'
        AND "proposalExecutedAt" IS NULL
        AND "proposalTransactionId" IS NULL
        AND ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
        AND "updatedAt" > NOW() - INTERVAL '${MAX_AGE_MINUTES} minutes'
      ORDER BY "updatedAt" DESC
      LIMIT 20
    `);

    if (approvedMatches.length === 0) {
      return; // No proposals to process
    }

    enhancedLogger.info('🔍 Proposal execution monitor: Scanning for Approved proposals', {
      found: approvedMatches.length,
      scanInterval: `${SCAN_INTERVAL_MS / 1000}s`,
      maxAge: `${MAX_AGE_MINUTES} minutes`,
      metrics: {
        checked: metrics.proposalsChecked,
        executed: metrics.proposalsExecuted,
        skippedAwaitingReady: metrics.proposalsSkippedAwaitingReady,
        skippedOther: metrics.proposalsSkippedOther,
        alreadyExecuted: metrics.proposalsAlreadyExecuted,
        errors: metrics.executionErrors,
      },
    });

    for (const match of approvedMatches) {
      try {
        metrics.proposalsChecked++;
        await processApprovedProposal(match, matchRepository);
      } catch (error: any) {
        metrics.executionErrors++;
        enhancedLogger.error('❌ Error processing Approved proposal', {
          matchId: match.id,
          proposalId: match.payoutProposalId || match.tieRefundProposalId,
          vaultAddress: match.squadsVaultAddress,
          error: error?.message,
          stack: error?.stack,
          attemptKey: `${match.id}:${match.payoutProposalId || match.tieRefundProposalId}`,
        });
        // Continue with next match - don't let one failure stop the monitor
      }
    }

    metrics.lastScanTime = new Date();
  } catch (error: any) {
    enhancedLogger.error('❌ Error scanning for Approved proposals', {
      error: error?.message,
      stack: error?.stack,
    });
  }
}

/**
 * Process a single Approved proposal
 */
async function processApprovedProposal(match: any, matchRepository: any): Promise<void> {
  const matchId = match.id;
  const proposalId = match.payoutProposalId || match.tieRefundProposalId;
  const vaultAddress = match.squadsVaultAddress;

  if (!proposalId || !vaultAddress) {
    return; // Skip if missing required data
  }

  const proposalIdString = String(proposalId).trim();
  const attemptKey = `${matchId}:${proposalIdString}`;

  // Check if we've already attempted execution recently
  const existingAttempt = executionAttempts.get(attemptKey);
  if (existingAttempt) {
    const now = new Date();
    if (now < existingAttempt.nextRetry) {
      // Too soon to retry
      return;
    }
    if (existingAttempt.attemptCount >= MAX_RETRY_ATTEMPTS) {
      // Max retries reached
      enhancedLogger.warn('⚠️ Max execution attempts reached for proposal', {
        matchId,
        proposalId: proposalIdString,
        attempts: existingAttempt.attemptCount,
      });
      return;
    }
  }

  try {
    // Check on-chain proposal status
    const squadsVaultService = getSquadsVaultService();
    const proposalStatus = await squadsVaultService.checkProposalStatus(vaultAddress, proposalIdString);

    if (proposalStatus.executed) {
      // Already executed - update database
      metrics.proposalsAlreadyExecuted++;
      enhancedLogger.info('✅ Proposal already executed on-chain, updating database', {
        matchId,
        proposalId: proposalIdString,
        vaultAddress,
        transactionIndex: proposalStatus.transactionIndex?.toString(),
        executionSignature: proposalStatus.executionSignature,
        note: 'Proposal was executed outside of monitor - syncing database state',
      });

      await matchRepository.query(`
        UPDATE "match"
        SET "proposalStatus" = 'EXECUTED',
            "proposalExecutedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = $1
      `, [matchId]);

      executionAttempts.delete(attemptKey);
      return;
    }

    // Check if proposal is ExecuteReady
    const { Connection, PublicKey } = require('@solana/web3.js');
    const { getProposalPda, accounts } = require('@sqds/multisig');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    const vaultPubkey = new PublicKey(vaultAddress);
    const multisigPda = require('@sqds/multisig').getMultisigPda({
      createKey: vaultPubkey,
    })[0];

    // Extract transaction index from proposal ID (PDA)
    const proposalPda = new PublicKey(proposalIdString);
    const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
    const transactionIndex = (proposalAccount as any).transactionIndex;
    const statusKind = (proposalAccount as any).status?.__kind;
    const approvedSigners = (proposalAccount as any).approved || [];
    const approvedSignersCount = approvedSigners.length;
    const approvedSignerPubkeys = approvedSigners.map((s: any) => s.toString());

    // Get multisig threshold to check if we have enough approvals
    let threshold = 2; // Default threshold for 2-of-2 multisig
    try {
      const multisigAccount = await accounts.Multisig.fromAccountAddress(connection, multisigPda);
      threshold = (multisigAccount as any).threshold || 2;
    } catch (e: any) {
      enhancedLogger.warn('⚠️ Could not fetch multisig threshold, using default', {
        matchId,
        vaultAddress,
        error: e?.message,
        defaultThreshold: 2,
      });
    }

    if (statusKind !== 'ExecuteReady') {
      // Not ready yet - check if it's still Approved (might need transition)
      if (statusKind === 'Approved') {
        // ✅ ENHANCED: Check if we have enough approvals to execute
        const hasEnoughApprovals = approvedSignersCount >= threshold;
        
        if (hasEnoughApprovals) {
          // ✅ FIX: Allow execution when Approved with threshold met
          // ExecuteReady may not trigger automatically - attempt execution anyway
          enhancedLogger.info('✅ Proposal is Approved with threshold met - attempting execution', {
            matchId,
            proposalId: proposalIdString,
            vaultAddress,
            transactionIndex: transactionIndex?.toString(),
            statusKind,
            approvedSignersCount,
            threshold,
            approvedSignerPubkeys,
            attemptKey,
            note: 'Proposal has enough approvals but not ExecuteReady - attempting execution anyway (ExecuteReady may not trigger automatically)',
            reason: 'APPROVED_WITH_THRESHOLD_MET',
          });
          
          // Continue to execution logic below - don't return
        } else {
          metrics.proposalsSkippedAwaitingReady++;
          enhancedLogger.info('⏳ Proposal is Approved but not ExecuteReady yet, waiting', {
            matchId,
            proposalId: proposalIdString,
            vaultAddress,
            transactionIndex: transactionIndex?.toString(),
            statusKind,
            approvedSignersCount,
            threshold,
            approvedSignerPubkeys,
            attemptKey,
            nextRetry: new Date(Date.now() + SCAN_INTERVAL_MS).toISOString(),
            note: `Approved but only ${approvedSignersCount}/${threshold} signers - waiting for more signatures`,
            reason: 'AWAITING_MORE_SIGNATURES',
          });
          return; // Will check again on next scan - need more signatures
        }
      } else {
        metrics.proposalsSkippedOther++;
        // ✅ WARN only for real anomalies (e.g., DB says APPROVED but on-chain is CANCELLED)
        enhancedLogger.warn('⚠️ Proposal is not in ExecuteReady or Approved state', {
          matchId,
          proposalId: proposalIdString,
          vaultAddress,
          transactionIndex: transactionIndex?.toString(),
          statusKind,
          dbStatus: match.proposalStatus,
          attemptKey,
          note: 'Skipping execution - proposal must be ExecuteReady to execute. This may indicate a state mismatch.',
          reason: 'UNEXPECTED_STATUS',
          anomaly: statusKind !== 'Approved' && match.proposalStatus === 'APPROVED' ? 'DB_APPROVED_BUT_ONCHAIN_NOT_APPROVED' : 'NORMAL_SKIP',
        });
        return;
      }
    }

    // ✅ ENHANCED: Allow execution if Approved with threshold met OR ExecuteReady
    const canExecute = statusKind === 'ExecuteReady' || 
                      (statusKind === 'Approved' && approvedSignersCount >= threshold);
    
    if (!canExecute) {
      enhancedLogger.warn('⚠️ Proposal cannot be executed - insufficient approvals or wrong status', {
        matchId,
        proposalId: proposalIdString,
        statusKind,
        approvedSignersCount,
        threshold,
        note: 'Proposal must be ExecuteReady OR Approved with threshold met to execute',
        reason: 'INSUFFICIENT_APPROVALS_OR_WRONG_STATUS',
      });
      return;
    }

    // ✅ ENHANCED: Log execution decision with diagnostics
    const executionReason = statusKind === 'ExecuteReady' 
      ? 'EXECUTE_READY' 
      : 'APPROVED_WITH_THRESHOLD_MET';
    
    enhancedLogger.info('🚀 Executing proposal (monitor)', {
      matchId,
      proposalId: proposalIdString,
      vaultAddress,
      transactionIndex: transactionIndex?.toString(),
      statusKind,
      approvedSignersCount,
      threshold,
      approvedSignerPubkeys,
      attemptKey,
      attemptCount: existingAttempt?.attemptCount || 0,
      executionReason,
      note: statusKind === 'ExecuteReady' 
        ? 'Proposal is ExecuteReady - proceeding with execution'
        : `Proposal is Approved with ${approvedSignersCount}/${threshold} signers - attempting execution (ExecuteReady may not trigger automatically)`,
    });

    const feeWalletKeypair = getFeeWalletKeypair();
    const executeResult = await squadsVaultService.executeProposal(
      vaultAddress,
      proposalIdString,
      feeWalletKeypair,
      match.squadsVaultPda ?? undefined
    );

    if (executeResult.success) {
      // Execution successful - update database
      const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
      const isTieRefund = !!match.tieRefundProposalId && String(match.tieRefundProposalId).trim() === proposalIdString;
      const isWinnerPayout = !!match.payoutProposalId && String(match.payoutProposalId).trim() === proposalIdString && match.winner && match.winner !== 'tie';

      const { buildProposalExecutionUpdates } = require('../utils/proposalExecutionUpdates');
      const executionUpdates = buildProposalExecutionUpdates({
        executedAt,
        signature: executeResult.signature ?? null,
        isTieRefund,
        isWinnerPayout,
      });

      // Persist execution updates to database
      const entries = Object.entries(executionUpdates || {});
      if (entries.length > 0) {
        const setClauses = entries.map(([key], idx) => `"${key}" = $${idx + 1}`);
        setClauses.push('"updatedAt" = NOW()');

        const values = entries.map(([, value]) => value);
        values.push(matchId);

        await matchRepository.query(`
          UPDATE "match"
          SET ${setClauses.join(', ')}
          WHERE id = $${entries.length + 1}
        `, values);
      }

      metrics.proposalsExecuted++;
      enhancedLogger.info('✅ Proposal executed successfully (monitor)', {
        matchId,
        proposalId: proposalIdString,
        vaultAddress,
        transactionIndex: transactionIndex?.toString(),
        executionSignature: executeResult.signature,
        slot: executeResult.slot,
        attemptKey,
        attemptCount: existingAttempt?.attemptCount || 0,
        executedAt: executeResult.executedAt,
        note: 'Proposal execution completed successfully',
        reason: 'EXECUTION_SUCCESS',
      });

      executionAttempts.delete(attemptKey);
    } else {
      // Execution failed - schedule retry
      const attemptCount = existingAttempt ? existingAttempt.attemptCount + 1 : 1;
      const nextRetry = new Date(Date.now() + RETRY_BACKOFF_MS * attemptCount);

      executionAttempts.set(attemptKey, {
        matchId,
        proposalId: proposalIdString,
        attemptCount,
        lastAttempt: new Date(),
        nextRetry,
      });

      enhancedLogger.warn('⚠️ Proposal execution failed, will retry', {
        matchId,
        proposalId: proposalIdString,
        vaultAddress,
        transactionIndex: transactionIndex?.toString(),
        error: executeResult.error,
        attemptCount,
        maxRetries: MAX_RETRY_ATTEMPTS,
        nextRetry: nextRetry.toISOString(),
        attemptKey,
        note: `Will retry up to ${MAX_RETRY_ATTEMPTS} times with exponential backoff`,
        reason: 'EXECUTION_FAILED',
      });
    }
  } catch (error: any) {
    // Error checking or executing - schedule retry
    const attemptCount = existingAttempt ? existingAttempt.attemptCount + 1 : 1;
    const nextRetry = new Date(Date.now() + RETRY_BACKOFF_MS * attemptCount);

    executionAttempts.set(attemptKey, {
      matchId,
      proposalId: proposalIdString,
      attemptCount,
      lastAttempt: new Date(),
      nextRetry,
    });

    enhancedLogger.error('❌ Error processing Approved proposal, will retry', {
      matchId,
      proposalId: proposalIdString,
      vaultAddress,
      error: error?.message,
      errorType: error?.constructor?.name,
      stack: error?.stack,
      attemptCount,
      maxRetries: MAX_RETRY_ATTEMPTS,
      nextRetry: nextRetry.toISOString(),
      attemptKey,
      note: `Will retry up to ${MAX_RETRY_ATTEMPTS} times with exponential backoff`,
      reason: 'PROCESSING_ERROR',
    });
  }
}

/**
 * Get current monitor metrics (for monitoring/dashboards)
 */
export function getMonitorMetrics(): MonitorMetrics {
  return { ...metrics };
}

/**
 * Clean up old execution attempts (prevent memory leak)
 */
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  for (const [key, attempt] of executionAttempts.entries()) {
    if (now - attempt.lastAttempt.getTime() > maxAge) {
      executionAttempts.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

/**
 * Log metrics summary periodically (for monitoring)
 */
setInterval(() => {
  if (isRunning && metrics.lastScanTime) {
    enhancedLogger.info('📊 Proposal execution monitor metrics', {
      metrics: {
        proposalsChecked: metrics.proposalsChecked,
        proposalsExecuted: metrics.proposalsExecuted,
        proposalsSkippedAwaitingReady: metrics.proposalsSkippedAwaitingReady,
        proposalsSkippedOther: metrics.proposalsSkippedOther,
        proposalsAlreadyExecuted: metrics.proposalsAlreadyExecuted,
        executionErrors: metrics.executionErrors,
        activeAttempts: executionAttempts.size,
        lastScanTime: metrics.lastScanTime.toISOString(),
      },
      note: 'Periodic metrics summary for monitoring/dashboards',
    });
  }
}, 10 * 60 * 1000); // Log metrics every 10 minutes


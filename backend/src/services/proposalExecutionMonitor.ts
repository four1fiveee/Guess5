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
import { withRateLimitBackoff } from '../utils/rateLimitBackoff';

/**
 * Helper function to normalize proposal status from enum format
 * Handles both string status and object with __kind property
 */
function getProposalStatusKind(status: any): string {
  if (typeof status === 'string') {
    return status;
  }
  if (typeof status === 'object' && status !== null && '__kind' in status) {
    return status.__kind;
  }
  return 'Unknown';
}

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
 * 
 * CRITICAL FIX: Now scans ALL proposals on-chain for each vault, not just DB-tracked proposals.
 * This prevents missing approved proposals due to DB ↔ on-chain desynchronization.
 */
async function scanAndExecuteProposals(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    enhancedLogger.warn('⚠️ Database not initialized, skipping proposal execution scan');
    return;
  }

  try {
    const matchRepository = AppDataSource.getRepository(Match);

    // CRITICAL FIX: Get all unique vault addresses from database
    // We'll scan all proposals on-chain for each vault, not just DB-tracked proposals
    const vaultsWithProposals = await matchRepository.query(`
      SELECT DISTINCT
        "squadsVaultAddress",
        "squadsVaultPda"
      FROM "match"
      WHERE 
        "squadsVaultAddress" IS NOT NULL
        AND ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
        AND "updatedAt" > NOW() - INTERVAL '${MAX_AGE_MINUTES * 2} minutes'
      ORDER BY "squadsVaultAddress"
      LIMIT 50
    `);

    if (vaultsWithProposals.length === 0) {
      return; // No vaults to scan
    }

    enhancedLogger.info('🔍 Proposal execution monitor: Scanning all on-chain proposals', {
      vaultsToScan: vaultsWithProposals.length,
      scanInterval: `${SCAN_INTERVAL_MS / 1000}s`,
      maxAge: `${MAX_AGE_MINUTES * 2} minutes`,
      metrics: {
        checked: metrics.proposalsChecked,
        executed: metrics.proposalsExecuted,
        skippedAwaitingReady: metrics.proposalsSkippedAwaitingReady,
        skippedOther: metrics.proposalsSkippedOther,
        alreadyExecuted: metrics.proposalsAlreadyExecuted,
        errors: metrics.executionErrors,
      },
      note: 'Now scanning ALL proposals on-chain for each vault, not just DB-tracked proposals',
    });

    // Scan all proposals on-chain for each vault
    for (const vaultInfo of vaultsWithProposals) {
      const vaultAddress = vaultInfo.squadsVaultAddress;
      if (!vaultAddress) continue;

      try {
        await scanVaultForApprovedProposals(vaultAddress, matchRepository);
      } catch (error: any) {
        metrics.executionErrors++;
        enhancedLogger.error('❌ Error scanning vault for approved proposals', {
          vaultAddress,
          error: error?.message,
          stack: error?.stack,
        });
        // Continue with next vault - don't let one failure stop the monitor
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
 * Scan a specific vault for all approved proposals on-chain
 * This ensures we catch approved proposals even if they're not tracked in the database
 */
async function scanVaultForApprovedProposals(vaultAddress: string, matchRepository: any): Promise<void> {
  try {
    const { PublicKey } = require('@solana/web3.js');
    const { getMultisigPda, getProposalPda, accounts } = require('@sqds/multisig');
    const { createStandardSolanaConnection } = require('../config/solanaConnection');
    const connection = createStandardSolanaConnection('confirmed');

    // vaultAddress is already the multisig PDA, not a createKey
    const multisigPda = new PublicKey(vaultAddress);

    // Get multisig account to determine threshold
    let threshold = 2; // Default
    try {
      const multisigAccount = await withRateLimitBackoff(() =>
        accounts.Multisig.fromAccountAddress(connection, multisigPda)
      );
      threshold = (multisigAccount as any).threshold || 2;
    } catch (e: any) {
      enhancedLogger.warn('⚠️ Could not fetch multisig threshold for vault scan', {
        vaultAddress,
        error: e?.message,
        defaultThreshold: 2,
      });
    }

    // CRITICAL: Get ALL proposals for this vault on-chain
    // We'll scan up to 20 transaction indices (0-19) to find all proposals
    const maxTransactionIndex = 20;
    const approvedProposals: Array<{
      transactionIndex: number;
      proposalPda: PublicKey;
      statusKind: string;
      approvedSigners: PublicKey[];
      approvedSignersCount: number;
    }> = [];

    // Get programId for PDA derivation (same pattern as proposalReconciliationService)
    const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

    for (let txIndex = 0; txIndex < maxTransactionIndex; txIndex++) {
      try {
        const [proposalPda] = getProposalPda({
          multisigPda,
          transactionIndex: txIndex,
          programId,
        });

        // ✅ Use rate limit backoff for on-chain calls
        const proposalAccount = await withRateLimitBackoff(() =>
          accounts.Proposal.fromAccountAddress(connection, proposalPda)
        );
        const statusKind = getProposalStatusKind((proposalAccount as any).status);
        const approvedSigners = (proposalAccount as any).approved || [];
        const approvedSignersCount = approvedSigners.length;

        // Skip if already executed
        if (statusKind === 'Executed') {
          continue; // Already executed - skip
        }

        // Check if this proposal is Approved or ExecuteReady
        if (statusKind === 'Approved' || statusKind === 'ExecuteReady') {
          // Verify it has enough approvals
          if (approvedSignersCount >= threshold) {
            approvedProposals.push({
              transactionIndex: txIndex,
              proposalPda,
              statusKind,
              approvedSigners,
              approvedSignersCount,
            });
            
            enhancedLogger.info('✅ Found approved proposal during vault scan', {
              vaultAddress,
              transactionIndex: txIndex,
              proposalPda: proposalPda.toString(),
              statusKind,
              approvedSignersCount,
              threshold,
            });
          }
        }
      } catch (e: any) {
        // Proposal doesn't exist at this index - continue scanning
        // This is expected for unused transaction indices
        if (!e?.message?.includes('Unable to find') && !e?.message?.includes('Account does not exist')) {
          // Log unexpected errors but continue scanning
          enhancedLogger.warn('⚠️ Error checking proposal at transaction index - continuing scan', {
            vaultAddress,
            transactionIndex: txIndex,
            error: e?.message || String(e),
            note: 'Continuing to next index - this error will not block the scan',
          });
        }
        // Continue to next index - don't let one error stop the entire scan
        continue;
      }
    }

    if (approvedProposals.length === 0) {
      return; // No approved proposals in this vault
    }

    enhancedLogger.info('✅ Found approved proposals on-chain', {
      vaultAddress,
      approvedCount: approvedProposals.length,
      proposals: approvedProposals.map(p => ({
        transactionIndex: p.transactionIndex,
        proposalPda: p.proposalPda.toString(),
        statusKind: p.statusKind,
        approvedSignersCount: p.approvedSignersCount,
      })),
    });

    // Process each approved proposal
    for (const proposal of approvedProposals) {
      try {
        metrics.proposalsChecked++;
        
        // Try to find matching match in database
        const proposalPdaString = proposal.proposalPda.toString();
        const matchingMatch = await matchRepository.query(`
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
            "squadsVaultAddress" = $1
            AND (
              "payoutProposalId" = $2 
              OR "tieRefundProposalId" = $2
            )
          LIMIT 1
        `, [vaultAddress, proposalPdaString]);

        // Skip if this proposal was already executed (check DB)
        if (matchingMatch.length > 0) {
          const dbMatch = matchingMatch[0];
          if (dbMatch.proposalExecutedAt || dbMatch.proposalTransactionId) {
            enhancedLogger.debug('⏭️ Skipping already-executed proposal', {
              vaultAddress,
              transactionIndex: proposal.transactionIndex,
              proposalPda: proposalPdaString,
              matchId: dbMatch.id,
              proposalExecutedAt: dbMatch.proposalExecutedAt,
              proposalTransactionId: dbMatch.proposalTransactionId,
            });
            continue; // Already executed - skip
          }
        }

        // ✅ CRITICAL FIX: If proposal is not in DB (orphaned), try to find and sync it to a match
        if (matchingMatch.length === 0) {
          enhancedLogger.info('🔍 Found orphaned Approved proposal, attempting to sync to match', {
            vaultAddress,
            transactionIndex: proposal.transactionIndex,
            proposalPda: proposalPdaString,
            note: 'This proposal exists on-chain but is not tracked in database',
          });
          
          // Try to find a match for this vault that doesn't have a proposal yet, or has a different one
          const vaultMatches = await matchRepository.query(`
            SELECT 
              id,
              "squadsVaultAddress",
              "payoutProposalId",
              "tieRefundProposalId",
              "proposalStatus",
              winner,
              status
            FROM "match"
            WHERE 
              "squadsVaultAddress" = $1
              AND status = 'completed'
              AND (
                "payoutProposalId" IS NULL 
                OR "payoutProposalId" != $2
                OR "proposalStatus" = 'SIGNATURE_VERIFICATION_FAILED'
              )
            ORDER BY "updatedAt" DESC
            LIMIT 1
          `, [vaultAddress, proposalPdaString]);
          
          if (vaultMatches.length > 0) {
            const targetMatch = vaultMatches[0];
            enhancedLogger.info('✅ Found match to sync orphaned proposal to', {
              matchId: targetMatch.id,
              vaultAddress,
              transactionIndex: proposal.transactionIndex,
              proposalPda: proposalPdaString,
              currentProposalId: targetMatch.payoutProposalId,
              currentStatus: targetMatch.proposalStatus,
            });
            
            // Sync the orphaned proposal to this match
            await matchRepository.update(targetMatch.id, {
              payoutProposalId: proposalPdaString,
              payoutProposalTransactionIndex: proposal.transactionIndex.toString(),
              proposalStatus: 'APPROVED',
              proposalSigners: JSON.stringify(proposal.approvedSigners.map((p: any) => p.toString())),
              needsSignatures: 0,
              updatedAt: new Date(),
            });
            
            // Use the synced match for processing
            const match = {
              ...targetMatch,
              payoutProposalId: proposalPdaString,
              payoutProposalTransactionIndex: proposal.transactionIndex.toString(),
              proposalStatus: 'APPROVED',
              proposalExecutedAt: null,
              proposalTransactionId: null,
            };
            
            await processApprovedProposal(match, matchRepository, proposal);
          } else {
            enhancedLogger.warn('⚠️ Orphaned proposal found but no matching match to sync to', {
              vaultAddress,
              transactionIndex: proposal.transactionIndex,
              proposalPda: proposalPdaString,
              note: 'Proposal will be skipped - may need manual intervention',
            });
            // Skip this orphaned proposal if we can't find a match to sync it to
            continue;
          }
        } else {
          // Proposal is already in DB - process normally
          const match = matchingMatch[0];
          await processApprovedProposal(match, matchRepository, proposal);
        }
      } catch (error: any) {
        metrics.executionErrors++;
        enhancedLogger.error('❌ Error processing approved proposal from vault scan', {
          vaultAddress,
          transactionIndex: proposal.transactionIndex,
          proposalPda: proposal.proposalPda.toString(),
          error: error?.message,
          stack: error?.stack,
        });
        // Continue with next proposal
      }
    }
  } catch (error: any) {
    enhancedLogger.error('❌ Error scanning vault for approved proposals', {
      vaultAddress,
      error: error?.message,
      stack: error?.stack,
    });
    throw error; // Re-throw to be caught by caller
  }
}

/**
 * Process a single Approved proposal
 * 
 * @param match - Match record from database (or synthetic record for orphaned proposals)
 * @param matchRepository - Database repository for matches
 * @param onChainProposal - Optional: On-chain proposal data if already fetched (from vault scan)
 */
async function processApprovedProposal(
  match: any, 
  matchRepository: any,
  onChainProposal?: {
    transactionIndex: number;
    proposalPda: any;
    statusKind: string;
    approvedSigners: any[];
    approvedSignersCount: number;
  }
): Promise<void> {
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
    // OPTIMIZATION: Use standard RPC for status checks (read-only operations)
    // Premium RPC is only needed for actual execution (handled by squadsVaultService.executeProposal)
    const { PublicKey } = require('@solana/web3.js');
    const { getProposalPda, accounts } = require('@sqds/multisig');
    const { createStandardSolanaConnection } = require('../config/solanaConnection');
    const connection = createStandardSolanaConnection('confirmed');

    const vaultPubkey = new PublicKey(vaultAddress);
    const multisigPda = require('@sqds/multisig').getMultisigPda({
      createKey: vaultPubkey,
    })[0];

    // OPTIMIZATION: Use on-chain proposal data if already fetched (from vault scan)
    // Otherwise, fetch it now
    let transactionIndex: any;
    let statusKind: string;
    let approvedSigners: any[];
    let approvedSignersCount: number;
    let approvedSignerPubkeys: string[];

    if (onChainProposal) {
      // Use pre-fetched data from vault scan
      transactionIndex = onChainProposal.transactionIndex;
      statusKind = onChainProposal.statusKind;
      approvedSigners = onChainProposal.approvedSigners;
      approvedSignersCount = onChainProposal.approvedSignersCount;
      approvedSignerPubkeys = approvedSigners.map((s: any) => s.toString());
      
      enhancedLogger.debug('✅ Using pre-fetched on-chain proposal data', {
        matchId,
        proposalId: proposalIdString,
        transactionIndex,
        statusKind,
        approvedSignersCount,
      });
    } else {
      // Fetch proposal account from on-chain
      const proposalPda = new PublicKey(proposalIdString);
      const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
      transactionIndex = (proposalAccount as any).transactionIndex;
      statusKind = getProposalStatusKind((proposalAccount as any).status);
      approvedSigners = (proposalAccount as any).approved || [];
      approvedSignersCount = approvedSigners.length;
      approvedSignerPubkeys = approvedSigners.map((s: any) => s.toString());
    }

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
      // CRITICAL: Log execution failure with comprehensive details
      metrics.executionErrors++;
      const attemptCount = existingAttempt ? existingAttempt.attemptCount + 1 : 1;
      const nextRetry = new Date(Date.now() + RETRY_BACKOFF_MS * attemptCount);

      executionAttempts.set(attemptKey, {
        matchId,
        proposalId: proposalIdString,
        attemptCount,
        lastAttempt: new Date(),
        nextRetry,
      });

      enhancedLogger.error('❌ Proposal execution failed (monitor) - will retry', {
        matchId,
        proposalId: proposalIdString,
        vaultAddress,
        transactionIndex: transactionIndex?.toString(),
        attemptKey,
        attemptCount,
        maxRetries: MAX_RETRY_ATTEMPTS,
        nextRetry: nextRetry.toISOString(),
        error: executeResult.error,
        errorCode: executeResult.errorCode,
        errorDetails: executeResult.errorDetails,
        attempts: executeResult.attempts,
        correlationId: executeResult.correlationId,
        statusKind,
        approvedSignersCount,
        threshold,
        note: `Execution failed - check error details above. Monitor will retry up to ${MAX_RETRY_ATTEMPTS} times with exponential backoff.`,
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


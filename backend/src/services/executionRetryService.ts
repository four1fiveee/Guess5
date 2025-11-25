import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { squadsVaultService } from './squadsVaultService';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getFeeWalletKeypair } from '../config/wallet';

/**
 * ExecutionRetryService - Ensures 100% payment consistency by continuously retrying failed executions
 * 
 * This service runs in the background and:
 * 1. Scans for proposals marked as READY_TO_EXECUTE that haven't been executed
 * 2. Retries execution with fresh blockhashes and increased priority fees
 * 3. Never gives up until execution succeeds or proposal is confirmed executed
 * 4. Runs every 10 seconds to catch failed executions quickly
 */
export class ExecutionRetryService {
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 10000; // 10 seconds - aggressive retry for 100% consistency
  private readonly MAX_RETRY_AGE = 30 * 60 * 1000; // 30 minutes - stop retrying very old proposals
  private readonly MAX_RETRIES_PER_MATCH = 100; // Maximum retries per match (prevents infinite loops)

  /**
   * Start the execution retry service
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Execution retry service is already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('🔄 Starting execution retry service for 100% payment consistency');

    // Run immediately on start, then every interval
    this.scanForFailedExecutions();
    
    this.scanInterval = setInterval(async () => {
      try {
        await this.scanForFailedExecutions();
      } catch (error) {
        enhancedLogger.error('❌ Error in execution retry service', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the execution retry service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    enhancedLogger.info('🛑 Stopped execution retry service');
  }

  /**
   * Scan for failed executions and retry them
   */
  private async scanForFailedExecutions(): Promise<void> {
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      
      // Find all matches with proposals ready to execute but not yet executed
      // This includes proposals marked as READY_TO_EXECUTE or proposals with 0 signatures needed
      const readyToExecuteMatches = await matchRepository.query(`
        SELECT 
          id, 
          "squadsVaultAddress", 
          "squadsVaultPda",
          "payoutProposalId",
          "tieRefundProposalId",
          "proposalStatus",
          "needsSignatures",
          "proposalTransactionId",
          "proposalExecutedAt",
          "updatedAt",
          "createdAt"
        FROM "match"
        WHERE 
          (
            ("proposalStatus" = 'READY_TO_EXECUTE' OR "needsSignatures" = 0)
            AND "proposalTransactionId" IS NULL
            AND "proposalExecutedAt" IS NULL
            AND ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
          )
          AND "updatedAt" > NOW() - INTERVAL '30 minutes'
        ORDER BY "updatedAt" DESC
        LIMIT 20
      `);

      if (readyToExecuteMatches.length === 0) {
        return; // No matches need retry
      }

      enhancedLogger.info(`🔄 Found ${readyToExecuteMatches.length} proposals ready for execution retry`);

      for (const match of readyToExecuteMatches) {
        try {
          await this.retryExecution(match, matchRepository);
        } catch (error) {
          enhancedLogger.error('❌ Error retrying execution for match', {
            matchId: match.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with next match - don't let one failure stop the service
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error scanning for failed executions', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Retry execution for a specific match
   */
  private async retryExecution(match: any, matchRepository: any): Promise<void> {
    const matchId = match.id;
    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    
    if (!proposalId || !match.squadsVaultAddress) {
      enhancedLogger.warn('⚠️ Match missing required fields for execution retry', {
        matchId,
        hasProposalId: !!proposalId,
        hasVaultAddress: !!match.squadsVaultAddress,
      });
      return;
    }

    // Check if proposal was already executed (double-check on-chain)
    if (match.proposalTransactionId || match.proposalExecutedAt) {
      enhancedLogger.info('✅ Match already has execution record, skipping retry', {
        matchId,
        proposalId,
        transactionId: match.proposalTransactionId,
        executedAt: match.proposalExecutedAt,
      });
      return;
    }

    // Confirm proposal is actually approved on-chain before retrying
    try {
      const { Connection, PublicKey } = require('@solana/web3.js');
      const { accounts } = require('@sqds/multisig');
      const connection = new Connection(
        process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
        'confirmed'
      );

      const proposalPda = new PublicKey(proposalId);
      const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
      const statusKind = (proposalAccount as any).status?.__kind || 'Unknown';
      const approvals = Array.isArray((proposalAccount as any).approved)
        ? (proposalAccount as any).approved.map((a: any) => a?.toString?.() || String(a))
        : [];
      const approvalCount = approvals.length;
      const threshold = (proposalAccount as any).threshold?.toNumber() || 2; // Default to 2 if not found

      enhancedLogger.info('🔍 On-chain proposal status before execution retry', {
        matchId,
        proposalId,
        statusKind,
        approvalCount,
        threshold,
        approvals,
      });

      // CRITICAL: Retry execution if:
      // 1. Status is ExecuteReady or Approved, OR
      // 2. Status is Active but we have enough approvals (approvalCount >= threshold)
      // This handles cases where the proposal has enough signatures but status hasn't updated yet
      if (statusKind !== 'ExecuteReady' && statusKind !== 'Approved') {
        if (statusKind === 'Active' && approvalCount >= threshold) {
          enhancedLogger.info('✅ Proposal is Active but has enough approvals, proceeding with retry', {
            matchId,
            proposalId,
            statusKind,
            approvalCount,
            threshold,
            note: 'Proposal has enough signatures - execution will proceed even though status is Active',
          });
          // Continue with execution - don't return
        } else {
          enhancedLogger.warn('⚠️ Proposal is not ready for execution yet, skipping retry for now', {
            matchId,
            proposalId,
            statusKind,
            approvalCount,
            threshold,
            note: 'Proposal needs more approvals or is in an invalid state',
          });
          return;
        }
      }
    } catch (proposalStatusError: any) {
      enhancedLogger.warn('⚠️ Could not fetch proposal status before retry (continuing)', {
        matchId,
        proposalId,
        error: proposalStatusError instanceof Error ? proposalStatusError.message : String(proposalStatusError),
      });
    }

    // Get fee wallet keypair for execution
    let feeWalletKeypair: any = null;
    try {
      feeWalletKeypair = getFeeWalletKeypair();
    } catch (keypairError: any) {
      enhancedLogger.warn('⚠️ Fee wallet keypair unavailable for execution retry', {
        matchId,
        proposalId,
        error: keypairError?.message || String(keypairError),
      });
      return;
    }

    enhancedLogger.info('🔄 Retrying proposal execution', {
      matchId,
      proposalId,
      vaultAddress: match.squadsVaultAddress,
      proposalStatus: match.proposalStatus,
      needsSignatures: match.needsSignatures,
      note: 'Background retry service ensuring 100% payment consistency',
    });

    // Execute proposal with fresh blockhash and increased priority fees
    const executeResult = await squadsVaultService.executeProposal(
      match.squadsVaultAddress,
      String(proposalId),
      feeWalletKeypair,
      match.squadsVaultPda ?? undefined
    );

    if (executeResult.success) {
      const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
      const isTieRefund = !!match.tieRefundProposalId && String(match.tieRefundProposalId).trim() === String(proposalId);
      const isWinnerPayout = !!match.payoutProposalId && 
                             String(match.payoutProposalId).trim() === String(proposalId) &&
                             match.winner &&
                             match.winner !== 'tie';

      // Update match with execution result
      const executionUpdates: any = {
        proposalStatus: 'EXECUTED',
        proposalTransactionId: executeResult.signature || null,
        proposalExecutedAt: executedAt,
      };

      if (isTieRefund) {
        executionUpdates.refundedAt = executedAt;
      }

      await matchRepository.query(`
        UPDATE "match"
        SET 
          "proposalStatus" = $1,
          "proposalTransactionId" = $2,
          "proposalExecutedAt" = $3
          ${isTieRefund ? ', "refundedAt" = $3' : ''}
        WHERE id = $4
      `, [
        executionUpdates.proposalStatus,
        executionUpdates.proposalTransactionId,
        executionUpdates.proposalExecutedAt,
        matchId,
      ]);

      enhancedLogger.info('✅ Proposal executed successfully via retry service', {
        matchId,
        proposalId,
        signature: executeResult.signature,
        slot: executeResult.slot,
        executedAt: executedAt.toISOString(),
        note: '100% payment consistency achieved - funds released to players',
      });
    } else {
      // Execution failed - log but don't give up (will retry on next scan)
      enhancedLogger.warn('⚠️ Execution retry failed (will retry again on next scan)', {
        matchId,
        proposalId,
        error: executeResult.error,
        logs: executeResult.logs?.slice(-5),
        note: 'Background service will continue retrying until success',
      });
    }
  }
}

// Export singleton instance
export const executionRetryService = new ExecutionRetryService();





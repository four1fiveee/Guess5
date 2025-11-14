/**
 * ProposalOnChainSyncService - Background service to reconcile on-chain proposal state
 * 
 * Expert recommendation: Keep a short synchronous check (≤ 2s) for fast validation,
 * then enqueue a background task to refresh on-chain truth and update DB.
 * 
 * This service:
 * 1. Checks on-chain proposal status for proposals that were recently signed
 * 2. Updates database with on-chain signer count
 * 3. Triggers execution if threshold is met on-chain but not yet executed
 * 4. Runs every 30 seconds to catch proposals that need reconciliation
 */

import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { squadsVaultService } from './squadsVaultService';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getFeeWalletKeypair } from '../config/wallet';
import { buildProposalExecutionUpdates } from '../utils/proposalExecutionUpdates';
import { applyProposalStateToMatch } from '../utils/proposalSigners';

export class ProposalOnChainSyncService {
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 30000; // 30 seconds - check for proposals needing reconciliation

  /**
   * Start the on-chain sync service
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Proposal on-chain sync service is already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('🔄 Starting proposal on-chain sync service');

    // Run immediately on start, then every interval
    this.syncProposals();
    
    this.scanInterval = setInterval(async () => {
      try {
        await this.syncProposals();
      } catch (error) {
        enhancedLogger.error('❌ Error in proposal on-chain sync service', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the on-chain sync service
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
    enhancedLogger.info('🛑 Stopping proposal on-chain sync service');
  }

  /**
   * Sync proposals with on-chain state
   */
  private async syncProposals(): Promise<void> {
    const matchRepository = AppDataSource.getRepository(Match);
    const now = new Date();
    
    // Find proposals that:
    // 1. Have a proposal ID (payout or tie refund)
    // 2. Are in ACTIVE or READY_TO_EXECUTE status
    // 3. Haven't been executed yet
    // 4. Were updated in the last 10 minutes (recent activity)
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    const proposalsToSync = await matchRepository.query(`
      SELECT 
        id, "squadsVaultAddress", "squadsVaultPda", "payoutProposalId", "tieRefundProposalId",
        "proposalStatus", "proposalSigners", "needsSignatures", "proposalExecutedAt",
        "player1", "player2", winner, "entryFee", "player1Result", "player2Result"
      FROM "match"
      WHERE 
        ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
        AND "proposalStatus" IN ('ACTIVE', 'READY_TO_EXECUTE', 'EXECUTING')
        AND "proposalExecutedAt" IS NULL
        AND "updatedAt" >= $1
      ORDER BY "updatedAt" DESC
      LIMIT 20
    `, [tenMinutesAgo.toISOString()]);

    if (proposalsToSync.length === 0) {
      return; // No proposals to sync
    }

    enhancedLogger.info(`🔍 Syncing ${proposalsToSync.length} proposals with on-chain state`);

    for (const match of proposalsToSync) {
      const matchId = match.id;
      const proposalIdString = match.payoutProposalId || match.tieRefundProposalId;

      if (!proposalIdString || !match.squadsVaultAddress) {
        continue;
      }

      try {
        // Check on-chain proposal status (no timeout in background - we can wait)
        const onChainStatus = await squadsVaultService.checkProposalStatus(
          match.squadsVaultAddress,
          proposalIdString
        );

        if (!onChainStatus) {
          enhancedLogger.warn('⚠️ Could not fetch on-chain status for proposal', {
            matchId,
            proposalId: proposalIdString,
          });
          continue;
        }

        const onChainSigners = onChainStatus.signers.map((s: any) => 
          s?.toString?.() || String(s)
        );
        const onChainNeedsSignatures = onChainStatus.needsSignatures ?? 2;
        const dbSigners = JSON.parse(match.proposalSigners || '[]');
        const dbNeedsSignatures = match.needsSignatures ?? 2;

        enhancedLogger.info('🔍 On-chain sync check', {
          matchId,
          proposalId: proposalIdString,
          onChainSigners,
          onChainSignerCount: onChainSigners.length,
          onChainNeedsSignatures,
          dbSigners,
          dbSignerCount: dbSigners.length,
          dbNeedsSignatures,
          executed: onChainStatus.executed,
        });

        // Update database if on-chain state differs
        if (onChainSigners.length !== dbSigners.length || 
            onChainNeedsSignatures !== dbNeedsSignatures) {
          enhancedLogger.info('📝 Updating database with on-chain state', {
            matchId,
            proposalId: proposalIdString,
            oldSigners: dbSigners,
            newSigners: onChainSigners,
            oldNeedsSignatures: dbNeedsSignatures,
            newNeedsSignatures: onChainNeedsSignatures,
          });

          const newStatus = onChainNeedsSignatures === 0 ? 'READY_TO_EXECUTE' : 'ACTIVE';
          
          await matchRepository.query(`
            UPDATE "match"
            SET "proposalSigners" = $1,
                "needsSignatures" = $2,
                "proposalStatus" = $3
            WHERE id = $4
          `, [
            JSON.stringify(onChainSigners),
            onChainNeedsSignatures,
            newStatus,
            matchId,
          ]);
        }

        // If on-chain shows threshold met but not executed, trigger execution
        if (onChainNeedsSignatures === 0 && !onChainStatus.executed && !match.proposalExecutedAt) {
          enhancedLogger.info('⚙️ On-chain threshold met, triggering execution', {
            matchId,
            proposalId: proposalIdString,
            onChainSigners,
            onChainSignerCount: onChainSigners.length,
          });

          try {
            const feeWalletKeypair = getFeeWalletKeypair();
            const executeResult = await squadsVaultService.executeProposal(
              match.squadsVaultAddress,
              proposalIdString,
              feeWalletKeypair,
              match.squadsVaultPda ?? undefined
            );

            if (executeResult.success) {
              const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
              const isTieRefund = !!match.tieRefundProposalId && String(match.tieRefundProposalId).trim() === proposalIdString;
              const isWinnerPayout = !!match.payoutProposalId && String(match.payoutProposalId).trim() === proposalIdString && match.winner && match.winner !== 'tie';

              const executionUpdates = buildProposalExecutionUpdates({
                executedAt,
                signature: executeResult.signature ?? null,
                isTieRefund,
                isWinnerPayout,
              });

              await matchRepository.query(`
                UPDATE "match"
                SET "proposalStatus" = 'EXECUTED',
                    "proposalExecutedAt" = $1,
                    "proposalTransactionId" = $2
                WHERE id = $3
              `, [
                executedAt.toISOString(),
                executeResult.signature,
                matchId,
              ]);

              enhancedLogger.info('✅ Proposal executed successfully by on-chain sync service', {
                matchId,
                proposalId: proposalIdString,
                executionSignature: executeResult.signature,
                slot: executeResult.slot,
              });
            } else {
              enhancedLogger.warn('⚠️ Execution failed in on-chain sync service', {
                matchId,
                proposalId: proposalIdString,
                error: executeResult.error,
                logs: executeResult.logs?.slice(-5),
              });
            }
          } catch (executeError: any) {
            enhancedLogger.error('❌ Error executing proposal in on-chain sync service', {
              matchId,
              proposalId: proposalIdString,
              error: executeError instanceof Error ? executeError.message : String(executeError),
            });
          }
        }
      } catch (error: any) {
        enhancedLogger.error('❌ Error syncing proposal with on-chain state', {
          matchId,
          proposalId: proposalIdString,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export const proposalOnChainSyncService = new ProposalOnChainSyncService();





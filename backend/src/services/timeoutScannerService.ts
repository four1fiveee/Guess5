import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { squadsVaultService } from './squadsVaultService';
import { enhancedLogger } from '../utils/enhancedLogger';

export class TimeoutScannerService {
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 30000; // 30 seconds
  private readonly MATCH_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly DEPOSIT_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  /**
   * Start the timeout scanner service
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Timeout scanner service is already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('⏰ Starting timeout scanner service');

    this.scanInterval = setInterval(async () => {
      try {
        await this.scanForTimeouts();
      } catch (error) {
        enhancedLogger.error('❌ Error in timeout scanner service', { error });
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the timeout scanner service
   */
  stop(): void {
    if (!this.isRunning) {
      enhancedLogger.warn('Timeout scanner service is not running');
      return;
    }

    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    enhancedLogger.info('🛑 Stopped timeout scanner service');
  }

  /**
   * Scan for matches that have timed out
   */
  private async scanForTimeouts(): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);

      const now = new Date();
      const matchTimeout = new Date(now.getTime() - this.MATCH_TIMEOUT);
      const depositTimeout = new Date(now.getTime() - this.DEPOSIT_TIMEOUT);

      // Find matches that need timeout processing
      const timeoutMatches = await matchRepository
        .createQueryBuilder('match')
        .where('match.matchStatus IN (:...statuses)', {
          statuses: ['PENDING', 'VAULT_CREATED', 'PAYMENT_REQUIRED'],
        })
        .andWhere('match.createdAt < :timeout', { timeout: matchTimeout })
        .getMany();

      enhancedLogger.debug(`⏰ Scanning ${timeoutMatches.length} matches for timeouts`);

      for (const match of timeoutMatches) {
        try {
          await this.processTimeoutMatch(match, auditLogRepository);
        } catch (error) {
          enhancedLogger.error('❌ Error processing timeout match', {
            matchId: match.id,
            error,
          });
        }
      }

      // Find matches with deposit timeouts
      const depositTimeoutMatches = await matchRepository
        .createQueryBuilder('match')
        .where('match.matchStatus = :status', { status: 'PAYMENT_REQUIRED' })
        .andWhere('match.createdAt < :timeout', { timeout: depositTimeout })
        .getMany();

      enhancedLogger.debug(`⏰ Scanning ${depositTimeoutMatches.length} matches for deposit timeouts`);

      for (const match of depositTimeoutMatches) {
        try {
          await this.processDepositTimeout(match, auditLogRepository);
        } catch (error) {
          enhancedLogger.error('❌ Error processing deposit timeout match', {
            matchId: match.id,
            error,
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error in scanForTimeouts', { error });
    }
  }

  /**
   * Process a match that has timed out
   */
  private async processTimeoutMatch(
    match: Match,
    auditLogRepository: any
  ): Promise<void> {
    try {
      enhancedLogger.info('⏰ Processing timeout match', {
        matchId: match.id,
        status: match.matchStatus,
        createdAt: match.createdAt,
      });

      // Determine timeout reason
      let timeoutReason = 'TIMEOUT_REFUND';
      if (match.matchStatus === 'PENDING') {
        timeoutReason = 'MATCH_TIMEOUT';
      } else if (match.matchStatus === 'VAULT_CREATED') {
        timeoutReason = 'VAULT_TIMEOUT';
      }

      // Process refund
      const refundResult = await squadsVaultService.proposeTieRefund(
        match.squadsVaultAddress!,
        new (require('@solana/web3.js').PublicKey)(match.player1),
        new (require('@solana/web3.js').PublicKey)(match.player2),
        match.entryFee
      );

      if (refundResult.success) {
        // Update match status
        match.matchStatus = 'REFUNDED';
        match.payoutProposalId = refundResult.proposalId;
        match.proposalStatus = 'ACTIVE';
        match.proposalCreatedAt = new Date();
        match.needsSignatures = 2; // 2-of-3 multisig
        await AppDataSource.getRepository(Match).save(match);

        // Log timeout event
        await this.logAuditEvent(auditLogRepository, match.id, 'TIMEOUT_PROPOSAL_CREATED', {
          timeoutReason,
          proposalId: refundResult.proposalId,
          originalStatus: match.matchStatus,
        });

        enhancedLogger.info('✅ Timeout refund proposal created', {
          matchId: match.id,
          timeoutReason,
          proposalId: refundResult.proposalId,
        });
      } else {
        enhancedLogger.error('❌ Failed to create timeout refund proposal', {
          matchId: match.id,
          error: refundResult.error,
        });
      }
    } catch (error) {
      enhancedLogger.error('❌ Error processing timeout match', {
        matchId: match.id,
        error,
      });
    }
  }

  /**
   * Process a match with deposit timeout
   */
  private async processDepositTimeout(
    match: Match,
    auditLogRepository: any
  ): Promise<void> {
    try {
      enhancedLogger.info('⏰ Processing deposit timeout match', {
        matchId: match.id,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
      });

      // Check if both players have paid
      if (match.player1Paid && match.player2Paid) {
        // Both players paid, but game didn't start - refund both
        const refundResult = await squadsVaultService.proposeTieRefund(
          match.id,
          'GAME_START_TIMEOUT'
        );

        if (refundResult.success) {
          match.matchStatus = 'REFUNDED';
          match.payoutProposalId = refundResult.proposalId;
          match.proposalStatus = 'ACTIVE';
          match.proposalCreatedAt = new Date();
          match.needsSignatures = 2; // 2-of-3 multisig
          await AppDataSource.getRepository(Match).save(match);

          await this.logAuditEvent(auditLogRepository, match.id, 'DEPOSIT_TIMEOUT_PROPOSAL_CREATED', {
            proposalId: refundResult.proposalId,
            reason: 'GAME_START_TIMEOUT',
          });

          enhancedLogger.info('✅ Deposit timeout refund proposal created', {
            matchId: match.id,
            proposalId: refundResult.proposalId,
          });
        }
      } else {
        // One or both players didn't pay - refund those who did
        const refundResult = await squadsVaultService.proposeTieRefund(
          match.id,
          'DEPOSIT_TIMEOUT'
        );

        if (refundResult.success) {
          match.matchStatus = 'REFUNDED';
          match.payoutProposalId = refundResult.proposalId;
          match.proposalStatus = 'ACTIVE';
          match.proposalCreatedAt = new Date();
          match.needsSignatures = 2; // 2-of-3 multisig
          await AppDataSource.getRepository(Match).save(match);

          await this.logAuditEvent(auditLogRepository, match.id, 'DEPOSIT_TIMEOUT_PROPOSAL_CREATED', {
            proposalId: refundResult.proposalId,
            reason: 'DEPOSIT_TIMEOUT',
          });

          enhancedLogger.info('✅ Deposit timeout refund proposal created', {
            matchId: match.id,
            proposalId: refundResult.proposalId,
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error processing deposit timeout match', {
        matchId: match.id,
        error,
      });
    }
  }

  /**
   * Log audit event
   */
  private async logAuditEvent(
    auditLogRepository: any,
    matchId: string,
    eventType: string,
    eventData: any
  ): Promise<void> {
    try {
      const auditLog = new MatchAuditLog();
      auditLog.matchId = matchId;
      auditLog.eventType = eventType;
      auditLog.eventData = eventData;
      await auditLogRepository.save(auditLog);
    } catch (error) {
      enhancedLogger.error('❌ Failed to log audit event', {
        matchId,
        eventType,
        error,
      });
    }
  }

  /**
   * Get service status
   */
  getStatus(): { isRunning: boolean; pollInterval: number } {
    return {
      isRunning: this.isRunning,
      pollInterval: this.POLL_INTERVAL,
    };
  }
}

// Export singleton instance
export const timeoutScannerService = new TimeoutScannerService();

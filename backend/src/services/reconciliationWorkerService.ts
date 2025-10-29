import { Connection, PublicKey } from '@solana/web3.js';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { enhancedLogger } from '../utils/enhancedLogger';

export class ReconciliationWorkerService {
  private connection: Connection;
  private isRunning: boolean = false;
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 60 * 1000; // 1 minute
  private readonly MAX_DISCREPANCY_THRESHOLD = 0.001; // 0.001 SOL

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
  }

  /**
   * Start the reconciliation worker service
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Reconciliation worker service is already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('🔄 Starting reconciliation worker service');

    this.reconciliationInterval = setInterval(async () => {
      try {
        await this.performReconciliation();
      } catch (error) {
        enhancedLogger.error('❌ Error in reconciliation worker service', { error });
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the reconciliation worker service
   */
  stop(): void {
    if (!this.isRunning) {
      enhancedLogger.warn('Reconciliation worker service is not running');
      return;
    }

    this.isRunning = false;
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }

    enhancedLogger.info('🛑 Stopped reconciliation worker service');
  }

  /**
   * Perform reconciliation between on-chain vault balances and database expectations
   */
  private async performReconciliation(): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);

      // Find active matches with vault addresses
      const activeMatches = await matchRepository.find({
        where: [
          { matchStatus: 'READY' },
          { matchStatus: 'ACTIVE' },
          { matchStatus: 'SETTLED' },
        ],
      });

      enhancedLogger.debug(`🔄 Reconciling ${activeMatches.length} active matches`);

      for (const match of activeMatches) {
        if (!match.squadsVaultAddress) continue;

        try {
          await this.reconcileMatch(match, auditLogRepository);
        } catch (error) {
          enhancedLogger.error('❌ Error reconciling match', {
            matchId: match.id,
            vaultAddress: match.squadsVaultAddress,
            error,
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error in performReconciliation', { error });
    }
  }

  /**
   * Reconcile a single match
   */
  private async reconcileMatch(
    match: Match,
    auditLogRepository: any
  ): Promise<void> {
    try {
      // Get on-chain vault balance
      const onChainBalance = await this.getVaultBalance(match.squadsVaultAddress!);
      
      // Calculate expected balance based on match state
      const expectedBalance = this.calculateExpectedBalance(match);
      
      // Check for discrepancies
      const discrepancy = Math.abs(onChainBalance - expectedBalance);
      
      if (discrepancy > this.MAX_DISCREPANCY_THRESHOLD) {
        enhancedLogger.warn('⚠️ Vault balance discrepancy detected', {
          matchId: match.id,
          vaultAddress: match.squadsVaultAddress,
          onChainBalance,
          expectedBalance,
          discrepancy,
        });

        // Log discrepancy event
        await this.logAuditEvent(auditLogRepository, match.id, 'BALANCE_DISCREPANCY', {
          vaultAddress: match.squadsVaultAddress,
          onChainBalance,
          expectedBalance,
          discrepancy,
          matchStatus: match.matchStatus,
        });

        // Alert administrators (in production, this would send notifications)
        await this.alertDiscrepancy(match, onChainBalance, expectedBalance, discrepancy);
      } else {
        enhancedLogger.debug('✅ Vault balance reconciled', {
          matchId: match.id,
          vaultAddress: match.squadsVaultAddress,
          onChainBalance,
          expectedBalance,
        });
      }
    } catch (error) {
      enhancedLogger.error('❌ Error reconciling match', {
        matchId: match.id,
        vaultAddress: match.squadsVaultAddress,
        error,
      });
    }
  }

  /**
   * Get vault balance from Solana
   */
  private async getVaultBalance(vaultAddress: string): Promise<number> {
    try {
      const vaultPubkey = new PublicKey(vaultAddress);
      const accountInfo = await this.connection.getAccountInfo(vaultPubkey);
      
      if (!accountInfo) {
        return 0;
      }

      return accountInfo.lamports;
    } catch (error) {
      enhancedLogger.error('❌ Error getting vault balance', {
        vaultAddress,
        error,
      });
      return 0;
    }
  }

  /**
   * Calculate expected vault balance based on match state
   */
  private calculateExpectedBalance(match: Match): number {
    const entryFeeLamports = Math.floor(match.entryFee * 1000000000); // Convert SOL to lamports

    switch (match.matchStatus) {
      case 'READY':
      case 'ACTIVE':
        // Both players should have deposited
        if (match.player1Paid && match.player2Paid) {
          return entryFeeLamports * 2; // Both players deposited
        } else if (match.player1Paid || match.player2Paid) {
          return entryFeeLamports; // One player deposited
        }
        return 0; // No deposits yet

      case 'SETTLED':
        // Match is settled, vault should be empty
        return 0;

      case 'REFUNDED':
        // Match is refunded, vault should be empty
        return 0;

      default:
        return 0;
    }
  }

  /**
   * Alert administrators about discrepancies
   */
  private async alertDiscrepancy(
    match: Match,
    onChainBalance: number,
    expectedBalance: number,
    discrepancy: number
  ): Promise<void> {
    try {
      // In production, this would send alerts to administrators
      // For now, we'll just log the alert
      enhancedLogger.error('🚨 ADMIN ALERT: Vault balance discrepancy', {
        matchId: match.id,
        vaultAddress: match.squadsVaultAddress,
        onChainBalance,
        expectedBalance,
        discrepancy,
        threshold: this.MAX_DISCREPANCY_THRESHOLD,
        severity: 'HIGH',
      });

      // Log alert event
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);
      await this.logAuditEvent(auditLogRepository, match.id, 'ADMIN_ALERT', {
        alertType: 'BALANCE_DISCREPANCY',
        onChainBalance,
        expectedBalance,
        discrepancy,
        threshold: this.MAX_DISCREPANCY_THRESHOLD,
        severity: 'HIGH',
      });
    } catch (error) {
      enhancedLogger.error('❌ Error sending discrepancy alert', {
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
export const reconciliationWorkerService = new ReconciliationWorkerService();

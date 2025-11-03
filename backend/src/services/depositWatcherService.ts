import { Connection, PublicKey } from '@solana/web3.js';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { enhancedLogger } from '../utils/enhancedLogger';
import { squadsVaultService } from './squadsVaultService';

export class DepositWatcherService {
  private connection: Connection;
  private isRunning: boolean = false;
  private watchInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 10000; // 10 seconds
  private readonly REQUIRED_CONFIRMATIONS = 8;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
  }

  /**
   * Start the deposit watcher service
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Deposit watcher service is already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('🔍 Starting deposit watcher service');

    this.watchInterval = setInterval(async () => {
      try {
        await this.checkPendingDeposits();
      } catch (error) {
        enhancedLogger.error('❌ Error in deposit watcher service', { error });
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the deposit watcher service
   */
  stop(): void {
    if (!this.isRunning) {
      enhancedLogger.warn('Deposit watcher service is not running');
      return;
    }

    this.isRunning = false;
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    enhancedLogger.info('🛑 Stopped deposit watcher service');
  }

  /**
   * Check for pending deposits and update confirmations
   */
  private async checkPendingDeposits(): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);

      // Find matches with vault created but deposits not fully confirmed
      const pendingMatches = await matchRepository.find({
        where: [
          { matchStatus: 'VAULT_CREATED' },
          { matchStatus: 'PENDING' },
        ],
      });

      enhancedLogger.debug(`🔍 Checking ${pendingMatches.length} pending deposits`);

      for (const match of pendingMatches) {
        if (!match.squadsVaultAddress) continue;

        try {
          // Verify deposits using squadsVaultService
          if (match.player1 && !match.depositAConfirmations) {
            await squadsVaultService.verifyDeposit(match.id, match.player1, match.entryFee, match.depositATx || undefined);
          }

          if (match.player2 && !match.depositBConfirmations) {
            await squadsVaultService.verifyDeposit(match.id, match.player2, match.entryFee, match.depositBTx || undefined);
          }

          // Reload match to get updated confirmations
          const updatedMatch = await matchRepository.findOne({ where: { id: match.id } });
          
          if (updatedMatch && 
              (updatedMatch.depositAConfirmations ?? 0) >= 1 && 
              (updatedMatch.depositBConfirmations ?? 0) >= 1 &&
              updatedMatch.matchStatus !== 'READY') {
            
            updatedMatch.matchStatus = 'READY';
            await matchRepository.save(updatedMatch);

            // Log deposit confirmation
            await this.logAuditEvent(auditLogRepository, match.id, 'DEPOSIT_CONFIRMED', {
              vaultAddress: match.squadsVaultAddress,
              depositAConfirmations: updatedMatch.depositAConfirmations,
              depositBConfirmations: updatedMatch.depositBConfirmations,
            });

            enhancedLogger.info('✅ Both deposits confirmed', {
              matchId: match.id,
              vaultAddress: match.squadsVaultAddress,
            });
          }
        } catch (error) {
          enhancedLogger.error('❌ Error verifying deposits', {
            matchId: match.id,
            vaultAddress: match.squadsVaultAddress,
            error,
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error in checkPendingDeposits', { error });
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
export const depositWatcherService = new DepositWatcherService();

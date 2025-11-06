import { depositWatcherService } from './depositWatcherService';
import { timeoutScannerService } from './timeoutScannerService';
import { reconciliationWorkerService } from './reconciliationWorkerService';
import { proposalExpirationService } from './proposalExpirationService';
import { enhancedLogger } from '../utils/enhancedLogger';

export class BackgroundServicesManager {
  private isRunning: boolean = false;

  /**
   * Start all background services
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Background services are already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('🚀 Starting all background services');

    try {
      // Start deposit watcher service
      depositWatcherService.start();
      enhancedLogger.info('✅ Deposit watcher service started');

      // Start timeout scanner service
      timeoutScannerService.start();
      enhancedLogger.info('✅ Timeout scanner service started');

      // Start reconciliation worker service
      reconciliationWorkerService.start();
      enhancedLogger.info('✅ Reconciliation worker service started');

      // Start proposal expiration scanner
      // Scan for expired proposals every 5 minutes
      setInterval(async () => {
        try {
          await proposalExpirationService.scanForExpiredProposals();
        } catch (error) {
          enhancedLogger.error('❌ Error during proposal expiration scan:', error);
        }
      }, 5 * 60 * 1000); // 5 minutes
      enhancedLogger.info('✅ Proposal expiration scanner started');

      enhancedLogger.info('🎉 All background services started successfully');
    } catch (error) {
      enhancedLogger.error('❌ Error starting background services', { error });
      this.stop(); // Stop any services that were started
      throw error;
    }
  }

  /**
   * Stop all background services
   */
  stop(): void {
    if (!this.isRunning) {
      enhancedLogger.warn('Background services are not running');
      return;
    }

    this.isRunning = false;
    enhancedLogger.info('🛑 Stopping all background services');

    try {
      // Stop deposit watcher service
      depositWatcherService.stop();
      enhancedLogger.info('✅ Deposit watcher service stopped');

      // Stop timeout scanner service
      timeoutScannerService.stop();
      enhancedLogger.info('✅ Timeout scanner service stopped');

      // Stop reconciliation worker service
      reconciliationWorkerService.stop();
      enhancedLogger.info('✅ Reconciliation worker service stopped');

      enhancedLogger.info('🎉 All background services stopped successfully');
    } catch (error) {
      enhancedLogger.error('❌ Error stopping background services', { error });
    }
  }

  /**
   * Get status of all background services
   */
  getStatus(): {
    isRunning: boolean;
    services: {
      depositWatcher: any;
      timeoutScanner: any;
      reconciliationWorker: any;
    };
  } {
    return {
      isRunning: this.isRunning,
      services: {
        depositWatcher: depositWatcherService.getStatus(),
        timeoutScanner: timeoutScannerService.getStatus(),
        reconciliationWorker: reconciliationWorkerService.getStatus(),
      },
    };
  }

  /**
   * Restart all background services
   */
  restart(): void {
    enhancedLogger.info('🔄 Restarting all background services');
    this.stop();
    setTimeout(() => {
      this.start();
    }, 1000); // Wait 1 second before restarting
  }
}

// Export singleton instance
export const backgroundServicesManager = new BackgroundServicesManager();

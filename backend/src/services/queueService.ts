import { Queue, Worker, Job } from 'bullmq';
import { getIoredisOps } from '../config/redis';
import { enhancedLogger } from '../utils/enhancedLogger';

// Job types
export interface PaymentJob {
  matchId: string;
  wallet: string;
  signature: string;
  amount: number;
}

export interface PayoutJob {
  matchId: string;
  winner: string;
  loser: string;
  entryFee: number;
  escrowAddress: string;
}

export interface CleanupJob {
  matchId: string;
  type: 'expired' | 'completed';
}

// Queue names
const QUEUE_NAMES = {
  PAYMENTS: 'ops:payments',
  PAYOUTS: 'ops:payouts',
  CLEANUP: 'ops:cleanup'
} as const;

class QueueService {
  private paymentQueue: Queue | null = null;
  private payoutQueue: Queue | null = null;
  private cleanupQueue: Queue | null = null;
  private workers: any[] = [];
  private initialized = false;

  constructor() {
    // Don't initialize immediately - wait for Redis to be ready
  }

  private async ensureInitialized() {
    if (this.initialized) return;

    try {
      const connection = getIoredisOps();

      // Initialize queues
      this.paymentQueue = new Queue(QUEUE_NAMES.PAYMENTS, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: 100,
          removeOnFail: 50
        }
      });

      this.payoutQueue = new Queue(QUEUE_NAMES.PAYOUTS, {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: 50,
          removeOnFail: 25
        }
      });

      this.cleanupQueue = new Queue(QUEUE_NAMES.CLEANUP, {
        connection,
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 1000
          },
          removeOnComplete: 200,
          removeOnFail: 100
        }
      });

      this.initializeWorkers();
      this.initialized = true;
      enhancedLogger.info('✅ Queue service initialized successfully');
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error initializing queue service:', error);
      throw error;
    }
  }

  /**
   * Initialize workers for processing jobs
   */
  private initializeWorkers(): void {
    // Payment verification worker
    const paymentWorker = new Worker(QUEUE_NAMES.PAYMENTS, async (job: Job<PaymentJob>) => {
      enhancedLogger.info(`💰 Processing payment job for match ${job.data.matchId}`);
      
      try {
        // For now, just log the payment job and return success
        // TODO: Implement actual payment verification when services are ready
        enhancedLogger.info(`✅ Payment job received for match ${job.data.matchId}`, {
          wallet: job.data.wallet,
          amount: job.data.amount,
          signature: job.data.signature
        });

        return { success: true, amount: job.data.amount };
      } catch (error: unknown) {
        enhancedLogger.error(`❌ Payment job failed for match ${job.data.matchId}:`, error);
        throw error;
      }
    }, {
      connection: getIoredisOps(),
      concurrency: 5
    });

    // Payout worker
    const payoutWorker = new Worker(QUEUE_NAMES.PAYOUTS, async (job: Job<PayoutJob>) => {
      enhancedLogger.info(`💸 Processing payout job for match ${job.data.matchId}`);
      
      try {
        // For now, just log the payout job and return success
        // TODO: Implement actual payout processing when services are ready
        enhancedLogger.info(`✅ Payout job received for match ${job.data.matchId}`, {
          winner: job.data.winner,
          loser: job.data.loser,
          entryFee: job.data.entryFee,
          escrowAddress: job.data.escrowAddress
        });

        return { success: true, transactionId: 'placeholder' };
      } catch (error: unknown) {
        enhancedLogger.error(`❌ Payout job failed for match ${job.data.matchId}:`, error);
        throw error;
      }
    }, {
      connection: getIoredisOps(),
      concurrency: 3
    });

    // Cleanup worker
    const cleanupWorker = new Worker(QUEUE_NAMES.CLEANUP, async (job: Job<CleanupJob>) => {
      enhancedLogger.info(`🧹 Processing cleanup job for match ${job.data.matchId}`);
      
      try {
        // For now, just log the cleanup job and return success
        // TODO: Implement actual cleanup when Redis matchmaking service is ready
        enhancedLogger.info(`✅ Cleanup job received for match ${job.data.matchId}`, {
          type: job.data.type
        });

        return { success: true };
      } catch (error: unknown) {
        enhancedLogger.error(`❌ Cleanup job failed for match ${job.data.matchId}:`, error);
        throw error;
      }
    }, {
      connection: getIoredisOps(),
      concurrency: 10
    });

    // Store workers for cleanup
    this.workers = [paymentWorker, payoutWorker, cleanupWorker];
  }

  /**
   * Add payment verification job
   */
  async addPaymentJob(data: PaymentJob): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.paymentQueue) {
        throw new Error('Payment queue not initialized');
      }

      await this.paymentQueue.add('verify-payment', data, {
        jobId: `payment_${data.matchId}_${data.wallet}`,
        delay: 1000 // 1 second delay to allow for blockchain confirmation
      });
      
      enhancedLogger.info(`📝 Added payment job for match ${data.matchId}`);
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error adding payment job:', error);
      throw error;
    }
  }

    /**
   * Add payout job
   */
  async addPayoutJob(data: PayoutJob): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.payoutQueue) {
        throw new Error('Payout queue not initialized');
      }

      await this.payoutQueue.add('process-payout', data, {
        jobId: `payout_${data.matchId}_${data.winner}`,
        delay: 2000 // 2 second delay
      });
      
      enhancedLogger.info(`📝 Added payout job for match ${data.matchId}`);
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error adding payout job:', error);
      throw error;
    }
  }

  /**
   * Add cleanup job
   */
  async addCleanupJob(data: CleanupJob, delay: number = 0): Promise<void> {
    try {
      await this.ensureInitialized();
      
      if (!this.cleanupQueue) {
        throw new Error('Cleanup queue not initialized');
      }

      await this.cleanupQueue.add('cleanup-match', data, {
        jobId: `cleanup_${data.matchId}_${data.type}`,
        delay
      });
      
      enhancedLogger.info(`📝 Added cleanup job for match ${data.matchId}`);
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error adding cleanup job:', error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    payments: { waiting: number; active: number; completed: number; failed: number };
    payouts: { waiting: number; active: number; completed: number; failed: number };
    cleanup: { waiting: number; active: number; completed: number; failed: number };
  }> {
    try {
      await this.ensureInitialized();
      
      if (!this.paymentQueue || !this.payoutQueue || !this.cleanupQueue) {
        throw new Error('Queues not initialized');
      }

      const [paymentStats, payoutStats, cleanupStats] = await Promise.all([
        this.paymentQueue.getJobCounts(),
        this.payoutQueue.getJobCounts(),
        this.cleanupQueue.getJobCounts()
      ]);

      return {
        payments: {
          waiting: paymentStats.waiting || 0,
          active: paymentStats.active || 0,
          completed: paymentStats.completed || 0,
          failed: paymentStats.failed || 0
        },
        payouts: {
          waiting: payoutStats.waiting || 0,
          active: payoutStats.active || 0,
          completed: payoutStats.completed || 0,
          failed: payoutStats.failed || 0
        },
        cleanup: {
          waiting: cleanupStats.waiting || 0,
          active: cleanupStats.active || 0,
          completed: cleanupStats.completed || 0,
          failed: cleanupStats.failed || 0
        }
      };
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error getting queue stats:', error);
      return {
        payments: { waiting: 0, active: 0, completed: 0, failed: 0 },
        payouts: { waiting: 0, active: 0, completed: 0, failed: 0 },
        cleanup: { waiting: 0, active: 0, completed: 0, failed: 0 }
      };
    }
  }

  /**
   * Close all queues
   */
  async close(): Promise<void> {
    try {
      if (!this.initialized) {
        enhancedLogger.info('🔌 Queue service not initialized, nothing to close');
        return;
      }

      // Close workers first
      for (const worker of this.workers) {
        await worker.close();
      }
      this.workers = [];

      // Close queues
      if (this.paymentQueue) {
        await this.paymentQueue.close();
      }
      if (this.payoutQueue) {
        await this.payoutQueue.close();
      }
      if (this.cleanupQueue) {
        await this.cleanupQueue.close();
      }
      
      this.initialized = false;
      enhancedLogger.info('🔌 All queues and workers closed');
    } catch (error: unknown) {
      enhancedLogger.error('❌ Error closing queues:', error);
    }
  }
}

// Export singleton instance
export const queueService = new QueueService();

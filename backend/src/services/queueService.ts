import { Queue, Worker, Job } from 'bullmq';
import { getRedisOps } from '../config/redis';
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
  amount: number;
  transactionData: any;
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
  private paymentQueue: Queue;
  private payoutQueue: Queue;
  private cleanupQueue: Queue;

  constructor() {
    const connection = getRedisOps();

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
  }

  /**
   * Initialize workers for processing jobs
   */
  private initializeWorkers(): void {
    // Payment verification worker
    new Worker(QUEUE_NAMES.PAYMENTS, async (job: Job<PaymentJob>) => {
      enhancedLogger.info(`💰 Processing payment job for match ${job.data.matchId}`);
      
      try {
        // Import here to avoid circular dependencies
        const { verifyPayment } = await import('./paymentVerificationService');
        
        const result = await verifyPayment(
          job.data.signature,
          job.data.amount,
          job.data.wallet
        );

        if (result.verified) {
          enhancedLogger.info(`✅ Payment verified for match ${job.data.matchId}`);
          
          // Update match status in Redis
          const { redisMatchmakingService } = await import('./redisMatchmakingService');
          await redisMatchmakingService.updateMatchStatus(
            job.data.matchId,
            'waiting_payment',
            {
              player1Paid: job.data.wallet === job.data.wallet ? true : undefined,
              player2Paid: job.data.wallet === job.data.wallet ? undefined : true
            }
          );

          return { success: true, amount: result.amount };
        } else {
          throw new Error(`Payment verification failed: ${result.error}`);
        }
      } catch (error) {
        enhancedLogger.error(`❌ Payment job failed for match ${job.data.matchId}:`, error);
        throw error;
      }
    }, {
      connection: getRedisOps(),
      concurrency: 5
    });

    // Payout worker
    new Worker(QUEUE_NAMES.PAYOUTS, async (job: Job<PayoutJob>) => {
      enhancedLogger.info(`💸 Processing payout job for match ${job.data.matchId}`);
      
      try {
        // Import here to avoid circular dependencies
        const { processPayout } = await import('./payoutService');
        
        const result = await processPayout(
          job.data.winner,
          job.data.amount,
          job.data.transactionData
        );

        enhancedLogger.info(`✅ Payout processed for match ${job.data.matchId}`);
        return { success: true, transactionId: result.transactionId };
      } catch (error) {
        enhancedLogger.error(`❌ Payout job failed for match ${job.data.matchId}:`, error);
        throw error;
      }
    }, {
      connection: getRedisOps(),
      concurrency: 3
    });

    // Cleanup worker
    new Worker(QUEUE_NAMES.CLEANUP, async (job: Job<CleanupJob>) => {
      enhancedLogger.info(`🧹 Processing cleanup job for match ${job.data.matchId}`);
      
      try {
        const { redisMatchmakingService } = await import('./redisMatchmakingService');
        
        if (job.data.type === 'expired') {
          // Handle expired match cleanup
          await redisMatchmakingService.updateMatchStatus(job.data.matchId, 'cancelled');
        } else if (job.data.type === 'completed') {
          // Handle completed match cleanup
          await redisMatchmakingService.updateMatchStatus(job.data.matchId, 'completed');
        }

        enhancedLogger.info(`✅ Cleanup completed for match ${job.data.matchId}`);
        return { success: true };
      } catch (error) {
        enhancedLogger.error(`❌ Cleanup job failed for match ${job.data.matchId}:`, error);
        throw error;
      }
    }, {
      connection: getRedisOps(),
      concurrency: 10
    });
  }

  /**
   * Add payment verification job
   */
  async addPaymentJob(data: PaymentJob): Promise<void> {
    try {
      await this.paymentQueue.add('verify-payment', data, {
        jobId: `payment_${data.matchId}_${data.wallet}`,
        delay: 1000 // 1 second delay to allow for blockchain confirmation
      });
      
      enhancedLogger.info(`📝 Added payment job for match ${data.matchId}`);
    } catch (error) {
      enhancedLogger.error('❌ Error adding payment job:', error);
      throw error;
    }
  }

  /**
   * Add payout job
   */
  async addPayoutJob(data: PayoutJob): Promise<void> {
    try {
      await this.payoutQueue.add('process-payout', data, {
        jobId: `payout_${data.matchId}_${data.wallet}`,
        delay: 2000 // 2 second delay
      });
      
      enhancedLogger.info(`📝 Added payout job for match ${data.matchId}`);
    } catch (error) {
      enhancedLogger.error('❌ Error adding payout job:', error);
      throw error;
    }
  }

  /**
   * Add cleanup job
   */
  async addCleanupJob(data: CleanupJob, delay: number = 0): Promise<void> {
    try {
      await this.cleanupQueue.add('cleanup-match', data, {
        jobId: `cleanup_${data.matchId}_${data.type}`,
        delay
      });
      
      enhancedLogger.info(`📝 Added cleanup job for match ${data.matchId}`);
    } catch (error) {
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
    } catch (error) {
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
      await Promise.all([
        this.paymentQueue.close(),
        this.payoutQueue.close(),
        this.cleanupQueue.close()
      ]);
      
      enhancedLogger.info('🔌 All queues closed');
    } catch (error) {
      enhancedLogger.error('❌ Error closing queues:', error);
    }
  }
}

// Export singleton instance
export const queueService = new QueueService();

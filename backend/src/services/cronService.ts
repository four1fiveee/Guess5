import { AppDataSource } from '../db';
import { User } from '../models/User';
import { Referral } from '../models/Referral';
import { UserService } from './userService';
import { referralPayoutService } from './payoutService';
import { getNextSunday1300EST, getNextSundayMidnightEST, isSundayMidnightEST } from '../utils/referralUtils';
import { notifyAdmin } from '../services/notificationService';
import { autoLockReferralPayouts } from './autoLockService';

/**
 * Cron service for scheduled tasks
 */
export class CronService {
  private static updateEntryFeesInterval: NodeJS.Timeout | null = null;
  private static weeklyPayoutInterval: NodeJS.Timeout | null = null;

  /**
   * Update user entry fees from matches (runs every 5 minutes)
   */
  static async updateUserEntryFees(): Promise<void> {
    try {
      console.log('🔄 Updating user entry fees from matches...');
      
      const userRepository = AppDataSource.getRepository(User);
      const users = await userRepository.find();

      for (const user of users) {
        await UserService.recomputeTotalEntryFees(user.walletAddress);
      }

      // Update referral eligibility (if referral table exists)
      try {
        const referralRepository = AppDataSource.getRepository(Referral);
        const referrals = await referralRepository.find({
          where: { eligible: false, active: true }
        });

        for (const referral of referrals) {
          const isEligible = await UserService.checkReferralEligibility(referral.referrerWallet);
          if (isEligible) {
            referral.eligible = true;
            await referralRepository.save(referral);
          }
        }
      } catch (error: any) {
        // Gracefully handle missing referral table (optional feature)
        if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
          // Referral table doesn't exist - this is optional, just skip
          console.log('ℹ️ Referral table not found - skipping referral eligibility update (optional feature)');
        } else {
          throw error; // Re-throw if it's a different error
        }
      }

      console.log(`✅ Updated entry fees for ${users.length} users`);
    } catch (error) {
      console.error('❌ Error updating user entry fees:', error);
    }
  }

  /**
   * Auto-lock referral payouts at 12:00am Sunday EST
   * Only includes referrers with >= $10 USD owed
   */
  static async autoLockReferralPayouts(): Promise<void> {
    try {
      console.log('🔒 Auto-locking referral payouts at 12:00am Sunday EST...');

      const lock = await autoLockReferralPayouts();

      if (lock) {
        console.log(`✅ Auto-locked ${lock.referrerCount} referrers with $${lock.totalAmountUSD.toFixed(2)} USD (${lock.totalAmountSOL.toFixed(6)} SOL)`);

        // Send notification to admin
        await notifyAdmin({
          type: 'referral_payout_auto_locked',
          title: 'Referral Payouts Auto-Locked',
          message: `Referral payouts have been auto-locked for ${lock.referrerCount} referrers with $${lock.totalAmountUSD.toFixed(2)} USD (${lock.totalAmountSOL.toFixed(6)} SOL). You can execute the payout between 9am-9pm EST today.`,
          lockId: lock.id,
          totalAmountUSD: lock.totalAmountUSD,
          totalAmountSOL: lock.totalAmountSOL,
          referrerCount: lock.referrerCount,
          lockDate: lock.lockDate
        });
      } else {
        console.log('ℹ️ No eligible payouts to lock (all referrers below $10 USD threshold)');
      }

    } catch (error) {
      console.error('❌ Error auto-locking referral payouts:', error);
    }
  }

  /**
   * Prepare weekly payout batch (runs Sunday 13:00 EST)
   * DEPRECATED: Now using auto-lock system instead
   */
  static async prepareWeeklyPayout(): Promise<void> {
    try {
      console.log('💰 Preparing weekly referral payout batch...');

      const nextSunday = getNextSunday1300EST();
      const batch = await referralPayoutService.preparePayoutBatch(nextSunday, 10, 'cron'); // Changed to $10 minimum

      console.log(`✅ Prepared payout batch ${batch.id} with $${batch.totalAmountUSD} USD`);

      // Send notification to admin
      await notifyAdmin({
        type: 'payout_batch_prepared',
        title: 'New Referral Payout Batch Prepared',
        message: `Payout batch ${batch.id} has been prepared with $${batch.totalAmountUSD.toFixed(2)} USD (${batch.totalAmountSOL.toFixed(6)} SOL). Please review and approve before payment.`,
        batchId: batch.id,
        totalAmountUSD: batch.totalAmountUSD,
        totalAmountSOL: batch.totalAmountSOL,
        scheduledSendAt: batch.scheduledSendAt
      });

    } catch (error) {
      console.error('❌ Error preparing weekly payout:', error);
    }
  }

  /**
   * Start all cron jobs
   */
  static start(): void {
    // Update entry fees every 5 minutes
    this.updateEntryFeesInterval = setInterval(() => {
      this.updateUserEntryFees();
    }, 5 * 60 * 1000);

    // Run immediately on start
    this.updateUserEntryFees();

    // Auto-lock referral payouts at 12:00am Sunday EST
    // Check every minute if it's Sunday midnight
    const checkAutoLock = setInterval(() => {
      if (isSundayMidnightEST()) {
        this.autoLockReferralPayouts();
      }
    }, 60 * 1000); // Check every minute

    // Also check immediately on start (in case server restarts during the window)
    if (isSundayMidnightEST()) {
      this.autoLockReferralPayouts();
    }

    // Calculate time until next Sunday 12:00am EST
    const now = new Date();
    const nextSundayMidnight = getNextSundayMidnightEST();
    let msUntilNextSunday = nextSundayMidnight.getTime() - now.getTime();

    // If it's already past Sunday midnight, schedule for next week
    if (msUntilNextSunday < 0) {
      msUntilNextSunday += 7 * 24 * 60 * 60 * 1000; // Add 7 days
    }

    // Schedule auto-lock for next Sunday midnight
    setTimeout(() => {
      this.autoLockReferralPayouts();
      // Then run every week at midnight
      this.weeklyPayoutInterval = setInterval(() => {
        this.autoLockReferralPayouts();
      }, 7 * 24 * 60 * 60 * 1000);
    }, msUntilNextSunday);

    console.log('✅ Cron jobs started');
    console.log(`   Auto-lock scheduled for next Sunday 12:00am EST (${Math.floor(msUntilNextSunday / (1000 * 60 * 60))} hours)`);
  }

  /**
   * Stop all cron jobs
   */
  static stop(): void {
    if (this.updateEntryFeesInterval) {
      clearInterval(this.updateEntryFeesInterval);
      this.updateEntryFeesInterval = null;
    }
    if (this.weeklyPayoutInterval) {
      clearInterval(this.weeklyPayoutInterval);
      this.weeklyPayoutInterval = null;
    }
    console.log('⏹️ Cron jobs stopped');
  }
}



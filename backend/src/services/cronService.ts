import { AppDataSource } from '../db';
import { User } from '../models/User';
import { Referral } from '../models/Referral';
import { UserService } from './userService';
import { referralPayoutService } from './payoutService';
import { getNextSunday1300EST } from '../utils/referralUtils';
import { notifyAdmin } from '../services/notificationService';

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
   * Prepare weekly payout batch (runs Sunday 13:00 EST)
   */
  static async prepareWeeklyPayout(): Promise<void> {
    try {
      console.log('💰 Preparing weekly referral payout batch...');

      const nextSunday = getNextSunday1300EST();
      const batch = await referralPayoutService.preparePayoutBatch(nextSunday, 20, 'cron');

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

    // Prepare weekly payout on Sunday 13:00 EST
    // Calculate time until next Sunday 13:00 EST
    const now = new Date();
    const nextSunday = getNextSunday1300EST();
    let msUntilNextSunday = nextSunday.getTime() - now.getTime();

    // If it's already past Sunday 13:00, schedule for next week
    if (msUntilNextSunday < 0) {
      msUntilNextSunday += 7 * 24 * 60 * 60 * 1000; // Add 7 days
    }

    // Schedule weekly payout
    setTimeout(() => {
      this.prepareWeeklyPayout();
      // Then run every week
      this.weeklyPayoutInterval = setInterval(() => {
        this.prepareWeeklyPayout();
      }, 7 * 24 * 60 * 60 * 1000);
    }, msUntilNextSunday);

    console.log('✅ Cron jobs started');
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



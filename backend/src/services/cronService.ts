import { AppDataSource } from '../db';
import { User } from '../models/User';
import { Referral } from '../models/Referral';
import { UserService } from './userService';
import { referralPayoutService } from './payoutService';

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

      // Update referral eligibility
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

      // TODO: Send notification to admin (Discord/Slack/Email)
      // await notifyAdmin(`New payout batch prepared: ${batch.id}`);

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

/**
 * Helper function to get next Sunday 13:00 EST
 */
function getNextSunday1300EST(): Date {
  const now = new Date();
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + (7 - now.getDay()));
  nextSunday.setHours(13, 0, 0, 0);
  return nextSunday;
}


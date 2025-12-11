import { AppDataSource } from '../db';
import { ReferralEarning } from '../models/ReferralEarning';
import { PayoutLock } from '../models/PayoutLock';
import { PriceService } from './priceService';
import { getCurrentEST } from '../utils/referralUtils';

const MIN_PAYOUT_USD = 10; // $10 USD minimum threshold

/**
 * Auto-lock referral payouts at 12:00am Sunday EST
 * Only includes referrers with >= $10 USD owed
 * Converts to SOL at current price
 */
export async function autoLockReferralPayouts(): Promise<PayoutLock | null> {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const lockRepository = AppDataSource.getRepository(PayoutLock);
    const estNow = getCurrentEST();
    
    // Get current Sunday date (lock date) - should be exactly midnight
    const lockDate = new Date(estNow);
    lockDate.setHours(0, 0, 0, 0);

    // Check if lock already exists for this Sunday
    const existingLock = await lockRepository.findOne({
      where: { lockDate },
    });

    if (existingLock) {
      console.log(`ℹ️ Lock already exists for ${lockDate.toISOString()}`);
      return existingLock;
    }

    // Get SOL price at lock time (12:00am Sunday)
    const solPrice = await PriceService.getSOLPrice();

    // Get all unpaid referrals, grouped by upline_wallet, with >= $10 USD threshold
    const eligibleResult = await earningRepository.query(`
      SELECT 
        upline_wallet,
        SUM(amount_usd) as total_usd,
        COUNT(*) as match_count
      FROM referral_earning
      WHERE paid = false
        AND amount_usd IS NOT NULL
      GROUP BY upline_wallet
      HAVING SUM(amount_usd) >= $1
      ORDER BY total_usd DESC
    `, [MIN_PAYOUT_USD]);

    // Calculate totals for eligible referrers only
    const totalUSD = eligibleResult.reduce((sum: number, row: any) => sum + parseFloat(row.total_usd || 0), 0);
    const totalSOL = totalUSD / solPrice; // Convert at lock time price
    const referrerCount = eligibleResult.length;

    // Get count of referrers below threshold (for logging)
    const belowThresholdResult = await earningRepository.query(`
      SELECT 
        COUNT(DISTINCT upline_wallet) as referrer_count,
        SUM(amount_usd) as total_usd
      FROM referral_earning
      WHERE paid = false
        AND amount_usd IS NOT NULL
      GROUP BY upline_wallet
      HAVING SUM(amount_usd) < $1
    `, [MIN_PAYOUT_USD]);

    const belowThresholdCount = belowThresholdResult.length;
    const belowThresholdUSD = belowThresholdResult.reduce((sum: number, row: any) => sum + parseFloat(row.total_usd || 0), 0);

    console.log(`🔒 Auto-locking referral payouts for ${lockDate.toISOString()}`);
    console.log(`   Eligible referrers (>= $${MIN_PAYOUT_USD}): ${referrerCount}`);
    console.log(`   Total eligible: $${totalUSD.toFixed(2)} USD (${totalSOL.toFixed(6)} SOL at $${solPrice.toFixed(2)}/SOL)`);
    console.log(`   Below threshold: ${belowThresholdCount} referrers with $${belowThresholdUSD.toFixed(2)} USD (carried to next week)`);

    // Create lock with eligible amounts only
    const lock = lockRepository.create({
      lockDate,
      totalAmountUSD: totalUSD,
      totalAmountSOL: totalSOL,
      referrerCount,
      lockedAt: new Date(),
    });

    const savedLock = await lockRepository.save(lock);

    console.log(`✅ Auto-locked ${referrerCount} referrers with $${totalUSD.toFixed(2)} USD (${totalSOL.toFixed(6)} SOL)`);

    return savedLock;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error auto-locking referral payouts:', errorMessage);
    throw error;
  }
}


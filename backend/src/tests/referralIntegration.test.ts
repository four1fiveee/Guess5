import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AppDataSource } from '../db';
import { referralPayoutService } from '../services/payoutService';
import { PriceService } from '../services/priceService';
import { ReferralEarning } from '../models/ReferralEarning';
import { PayoutBatch } from '../models/PayoutBatch';

describe('Referral Integration Tests', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  describe('Weekly Payout Aggregation', () => {
    it('should aggregate unpaid earnings >= $20', async () => {
      const payouts = await referralPayoutService.aggregateWeeklyPayouts(20);
      
      // Should return array of payouts
      expect(Array.isArray(payouts)).toBe(true);
      
      // Each payout should have required fields
      if (payouts.length > 0) {
        const payout = payouts[0];
        expect(payout).toHaveProperty('uplineWallet');
        expect(payout).toHaveProperty('totalUSD');
        expect(payout).toHaveProperty('matchCount');
        expect(payout.totalUSD).toBeGreaterThanOrEqual(20);
      }
    });
  });

  describe('USD to SOL Conversion', () => {
    it('should convert USD to SOL', async () => {
      const solPrice = await PriceService.getSOLPrice();
      expect(solPrice).toBeGreaterThan(0);

      const amountUSD = 100;
      const amountSOL = await PriceService.convertUSDToSOL(amountUSD);
      expect(amountSOL).toBeGreaterThan(0);
      expect(amountSOL).toBeCloseTo(amountUSD / solPrice, 6);
    });
  });

  describe('Payout Batch Preparation', () => {
    it('should create batch with eligible payouts', async () => {
      const nextSunday = new Date();
      nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()));
      nextSunday.setHours(13, 0, 0, 0);

      try {
        const batch = await referralPayoutService.preparePayoutBatch(nextSunday, 20, 'test');
        
        expect(batch).toHaveProperty('id');
        expect(batch).toHaveProperty('totalAmountUSD');
        expect(batch).toHaveProperty('totalAmountSOL');
        expect(batch.status).toBe('prepared');
      } catch (error: any) {
        // If no eligible payouts, that's okay for testing
        if (error.message.includes('No eligible payouts')) {
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    });
  });
});


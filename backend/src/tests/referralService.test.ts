import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AppDataSource } from '../db';
import { ReferralService } from '../services/referralService';
import { UserService } from '../services/userService';
import { Match } from '../models/Match';
import { Referral } from '../models/Referral';
import { ReferralEarning } from '../models/ReferralEarning';

describe('ReferralService', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  describe('computeReferralEarningsForMatch', () => {
    it('should calculate earnings correctly for 3-level chain', async () => {
      // Create test match with netProfit = $100
      const matchRepository = AppDataSource.getRepository(Match);
      const match = matchRepository.create({
        player1: 'player1_wallet',
        player2: 'player2_wallet',
        entryFee: 0.1,
        platformFee: 0.01,
        bonusAmount: 0.002,
        squadsCost: 0.001,
        netProfit: 0.007, // $7 USD equivalent
        netProfitUSD: 7,
        isCompleted: true,
        status: 'completed'
      });
      const savedMatch = await matchRepository.save(match);

      // Create referral chain: player1 -> referrer1 -> referrer2 -> referrer3
      const referralRepository = AppDataSource.getRepository(Referral);
      
      // Make referrer1 eligible
      await UserService.updateUserEntryFees('referrer1_wallet', 100, 0.67);
      
      const ref1 = referralRepository.create({
        referredWallet: 'player1_wallet',
        referrerWallet: 'referrer1_wallet',
        eligible: true,
        active: true
      });
      await referralRepository.save(ref1);

      const ref2 = referralRepository.create({
        referredWallet: 'referrer1_wallet',
        referrerWallet: 'referrer2_wallet',
        eligible: true,
        active: true
      });
      await referralRepository.save(ref2);

      const ref3 = referralRepository.create({
        referredWallet: 'referrer2_wallet',
        referrerWallet: 'referrer3_wallet',
        eligible: true,
        active: true
      });
      await referralRepository.save(ref3);

      // Rebuild upline mapping
      await ReferralService.buildUplineMapping();

      // Compute earnings
      await ReferralService.computeReferralEarningsForMatch(savedMatch.id);

      // Verify earnings
      const earningRepository = AppDataSource.getRepository(ReferralEarning);
      const earnings = await earningRepository.find({
        where: { matchId: savedMatch.id }
      });

      // Expected: referralPool = 0.25 * 7 = $1.75
      // perPlayerShare = 1.75 / 2 = $0.875
      // L1 = $0.875, L2 = $0.21875, L3 = $0.0546875
      expect(earnings.length).toBeGreaterThan(0);
      
      const l1Earnings = earnings.filter(e => e.level === 1);
      const l2Earnings = earnings.filter(e => e.level === 2);
      const l3Earnings = earnings.filter(e => e.level === 3);

      expect(l1Earnings.length).toBeGreaterThan(0);
      expect(l2Earnings.length).toBeGreaterThan(0);
      expect(l3Earnings.length).toBeGreaterThan(0);

      // Check geometric decay
      if (l1Earnings.length > 0 && l2Earnings.length > 0) {
        const l1Amount = Number(l1Earnings[0].amountUSD);
        const l2Amount = Number(l2Earnings[0].amountUSD);
        expect(l2Amount).toBeCloseTo(l1Amount * 0.25, 2);
      }
    });

    it('should skip earnings if netProfit is zero or negative', async () => {
      const matchRepository = AppDataSource.getRepository(Match);
      const match = matchRepository.create({
        player1: 'player1_wallet',
        player2: 'player2_wallet',
        entryFee: 0.1,
        platformFee: 0.01,
        bonusAmount: 0.01,
        squadsCost: 0.001,
        netProfit: -0.001, // Negative profit
        netProfitUSD: -0.1,
        isCompleted: true,
        status: 'completed'
      });
      const savedMatch = await matchRepository.save(match);

      await ReferralService.computeReferralEarningsForMatch(savedMatch.id);

      const earningRepository = AppDataSource.getRepository(ReferralEarning);
      const earnings = await earningRepository.find({
        where: { matchId: savedMatch.id }
      });

      expect(earnings.length).toBe(0);
    });
  });

  describe('getReferrerChain', () => {
    it('should return chain up to maxDepth', async () => {
      const referralRepository = AppDataSource.getRepository(Referral);
      
      // Create chain
      const ref1 = referralRepository.create({
        referredWallet: 'wallet1',
        referrerWallet: 'wallet2',
        eligible: true,
        active: true
      });
      await referralRepository.save(ref1);

      const ref2 = referralRepository.create({
        referredWallet: 'wallet2',
        referrerWallet: 'wallet3',
        eligible: true,
        active: true
      });
      await referralRepository.save(ref2);

      const chain = await ReferralService.getReferrerChain('wallet1', 3);
      expect(chain.length).toBe(2);
      expect(chain[0].wallet).toBe('wallet2');
      expect(chain[1].wallet).toBe('wallet3');
    });
  });
});


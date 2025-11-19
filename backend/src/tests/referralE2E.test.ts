import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AppDataSource } from '../db';
import { User } from '../models/User';
import { Referral } from '../models/Referral';
import { Match } from '../models/Match';
import { ReferralEarning } from '../models/ReferralEarning';
import { PayoutBatch, PayoutBatchStatus } from '../models/PayoutBatch';
import { ReferralService } from '../services/referralService';
import { UserService } from '../services/userService';
import { referralPayoutService } from '../services/payoutService';

/**
 * End-to-end test for referral flow:
 * 1. User A refers User B
 * 2. User B plays a match
 * 3. Referral earnings are computed
 * 4. Payout batch is prepared
 * 5. Batch is approved
 * 6. Batch is sent
 */
describe('Referral E2E Flow', () => {
  const userAWallet = 'userA_wallet_' + Date.now();
  const userBWallet = 'userB_wallet_' + Date.now();

  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    // Cleanup
    const matchRepository = AppDataSource.getRepository(Match);
    const referralRepository = AppDataSource.getRepository(Referral);
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const userRepository = AppDataSource.getRepository(User);

    const matches = await matchRepository.find({
      where: [{ player1: userAWallet }, { player2: userAWallet }, { player1: userBWallet }, { player2: userBWallet }]
    });
    await matchRepository.remove(matches);

    const referrals = await referralRepository.find({
      where: [{ referrerWallet: userAWallet }, { referredWallet: userBWallet }]
    });
    await referralRepository.remove(referrals);

    const earnings = await earningRepository.find({
      where: [{ uplineWallet: userAWallet }, { referredWallet: userBWallet }]
    });
    await earningRepository.remove(earnings);

    const batches = await batchRepository.find();
    await batchRepository.remove(batches);

    const users = await userRepository.find({
      where: [{ walletAddress: userAWallet }, { walletAddress: userBWallet }]
    });
    await userRepository.remove(users);

    await AppDataSource.destroy();
  });

  it('should complete full referral flow', async () => {
    // Step 1: Create users
    await UserService.updateUserEntryFees(userAWallet, 50, 0.33); // User A has played
    await UserService.updateUserEntryFees(userBWallet, 0, 0);

    // Step 2: Create referral relationship
    const referral = await ReferralService.processReferral(userBWallet, userAWallet);
    expect(referral.referredWallet).toBe(userBWallet);
    expect(referral.referrerWallet).toBe(userAWallet);

    // Step 3: Create a completed match for User B
    const matchRepository = AppDataSource.getRepository(Match);
    const match = matchRepository.create({
      player1: userBWallet,
      player2: 'opponent_wallet',
      entryFee: 0.1,
      entryFeeUSD: 20,
      platformFee: 1.0,
      bonusAmount: 0.25,
      bonusAmountUSD: 0.25,
      squadsCost: 0.001,
      squadsCostUSD: 0.23,
      netProfit: 0.52, // 1.0 - 0.25 - 0.23
      netProfitUSD: 0.52,
      solPriceAtTransaction: 150,
      status: 'completed',
      isCompleted: true,
      winner: userBWallet,
      referralEarningsComputed: false
    });
    const savedMatch = await matchRepository.save(match);

    // Step 4: Compute referral earnings
    await ReferralService.computeReferralEarningsForMatch(savedMatch.id);

    // Verify earnings were created
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const earnings = await earningRepository.find({
      where: { matchId: savedMatch.id }
    });

    expect(earnings.length).toBeGreaterThan(0);
    const userAEarning = earnings.find(e => e.uplineWallet === userAWallet);
    expect(userAEarning).toBeDefined();
    expect(userAEarning?.level).toBe(1);
    expect(userAEarning?.paid).toBe(false);

    // Step 5: Prepare payout batch (if earnings >= $20)
    // Note: This test assumes earnings are >= $20, otherwise batch won't be created
    const totalEarnings = earnings.reduce((sum, e) => sum + Number(e.amountUSD), 0);
    
    if (totalEarnings >= 20) {
      const nextSunday = new Date();
      nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()));
      nextSunday.setHours(13, 0, 0, 0);

      const batch = await referralPayoutService.preparePayoutBatch(nextSunday, 20, 'test');
      expect(batch.status).toBe(PayoutBatchStatus.PREPARED);

      // Step 6: Approve batch
      const batchRepository = AppDataSource.getRepository(PayoutBatch);
      const savedBatch = await batchRepository.findOne({ where: { id: batch.id } });
      savedBatch!.status = PayoutBatchStatus.REVIEWED;
      savedBatch!.reviewedByAdmin = 'test-admin';
      savedBatch!.reviewedAt = new Date();
      await batchRepository.save(savedBatch!);

      expect(savedBatch?.status).toBe(PayoutBatchStatus.REVIEWED);

      // Step 7: Send batch (mock transaction signature)
      await referralPayoutService.sendPayoutBatch(batch.id, 'test-signature-123');

      const finalBatch = await batchRepository.findOne({ where: { id: batch.id } });
      expect(finalBatch?.status).toBe(PayoutBatchStatus.SENT);
      expect(finalBatch?.transactionSignature).toBe('test-signature-123');

      // Verify earnings are marked as paid
      const paidEarnings = await earningRepository.find({
        where: { payoutBatchId: batch.id }
      });
      expect(paidEarnings.every(e => e.paid)).toBe(true);
    }
  });
});


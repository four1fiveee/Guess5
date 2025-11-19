import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { AppDataSource } from '../db';
import { CronService } from '../services/cronService';
import { UserService } from '../services/userService';
import { referralPayoutService } from '../services/payoutService';
import { notifyAdmin } from '../services/notificationService';

// Mock dependencies
jest.mock('../services/notificationService');
jest.mock('../services/payoutService');

describe('CronService', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
    CronService.stop();
  });

  describe('updateUserEntryFees', () => {
    it('should update user entry fees from matches', async () => {
      // Mock UserService
      const mockRecomputeTotalEntryFees = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(UserService, 'recomputeTotalEntryFees').mockImplementation(mockRecomputeTotalEntryFees);

      await CronService.updateUserEntryFees();

      // Verify it was called (at least once for each user)
      expect(mockRecomputeTotalEntryFees).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(UserService, 'recomputeTotalEntryFees').mockRejectedValue(new Error('Test error'));

      // Should not throw
      await expect(CronService.updateUserEntryFees()).resolves.not.toThrow();
    });
  });

  describe('prepareWeeklyPayout', () => {
    it('should prepare payout batch and send notification', async () => {
      const mockBatch = {
        id: 'test-batch-id',
        totalAmountUSD: 100,
        totalAmountSOL: 0.5,
        scheduledSendAt: new Date()
      };

      jest.spyOn(referralPayoutService, 'preparePayoutBatch').mockResolvedValue(mockBatch as any);
      jest.spyOn(require('../services/notificationService'), 'notifyAdmin').mockResolvedValue(undefined);

      await CronService.prepareWeeklyPayout();

      expect(referralPayoutService.preparePayoutBatch).toHaveBeenCalled();
      expect(notifyAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'payout_batch_prepared',
          batchId: 'test-batch-id'
        })
      );
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(referralPayoutService, 'preparePayoutBatch').mockRejectedValue(new Error('Test error'));

      // Should not throw
      await expect(CronService.prepareWeeklyPayout()).resolves.not.toThrow();
    });
  });

  describe('start', () => {
    it('should start cron jobs', () => {
      const startSpy = jest.spyOn(CronService, 'updateUserEntryFees');
      
      CronService.start();

      // Verify updateUserEntryFees was called immediately
      expect(startSpy).toHaveBeenCalled();

      // Clean up
      CronService.stop();
    });
  });
});


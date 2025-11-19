import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { AppDataSource } from '../db';
import { PayoutBatch, PayoutBatchStatus } from '../models/PayoutBatch';
import { ReferralEarning } from '../models/ReferralEarning';
import { referralPayoutService } from '../services/payoutService';
import { notifyAdmin } from '../services/notificationService';
import { adminPreparePayoutBatch, adminApprovePayoutBatch, adminSendPayoutBatch } from '../controllers/adminController';

// Mock dependencies
jest.mock('../services/payoutService', () => ({
  referralPayoutService: {
    preparePayoutBatch: jest.fn(),
    validatePayoutBatch: jest.fn(),
    sendPayoutBatch: jest.fn()
  }
}));

jest.mock('../services/notificationService', () => ({
  notifyAdmin: jest.fn()
}));

describe('Admin Controller - Payout Management', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  describe('adminPreparePayoutBatch', () => {
    it('should prepare a payout batch', async () => {
      const mockBatch = {
        id: 'test-batch-id',
        totalAmountUSD: 100,
        totalAmountSOL: 0.5,
        status: PayoutBatchStatus.PREPARED,
        scheduledSendAt: new Date()
      };

      jest.spyOn(referralPayoutService, 'preparePayoutBatch').mockResolvedValue(mockBatch as any);
      jest.spyOn(referralPayoutService, 'validatePayoutBatch').mockResolvedValue({
        valid: true,
        warnings: [],
        errors: []
      });

      const req = {
        body: { minPayoutUSD: 20 },
        headers: { 'x-admin-user': 'test-admin' }
      } as any;

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      } as any;

      await adminPreparePayoutBatch(req, res);

      expect(referralPayoutService.preparePayoutBatch).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          batch: expect.objectContaining({
            id: 'test-batch-id'
          })
        })
      );
    });
  });

  describe('adminApprovePayoutBatch', () => {
    it('should approve a prepared batch', async () => {
      const batchRepository = AppDataSource.getRepository(PayoutBatch);
      const batch = batchRepository.create({
        batchAt: new Date(),
        scheduledSendAt: new Date(),
        minPayoutUSD: 20,
        status: PayoutBatchStatus.PREPARED,
        totalAmountUSD: 100,
        totalAmountSOL: 0.5
      });
      const savedBatch = await batchRepository.save(batch);

      jest.spyOn(referralPayoutService, 'validatePayoutBatch').mockResolvedValue({
        valid: true,
        warnings: [],
        errors: []
      });

      const req = {
        params: { batchId: savedBatch.id },
        headers: { 'x-admin-user': 'test-admin' }
      } as any;

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      } as any;

      await adminApprovePayoutBatch(req, res);

      // Verify batch was updated
      const updatedBatch = await batchRepository.findOne({ where: { id: savedBatch.id } });
      expect(updatedBatch?.status).toBe(PayoutBatchStatus.REVIEWED);
      expect(updatedBatch?.reviewedByAdmin).toBe('test-admin');
      expect(updatedBatch?.reviewedAt).toBeDefined();

      // Clean up
      await batchRepository.remove(updatedBatch!);
    });

    it('should reject approval if batch is not in PREPARED status', async () => {
      const batchRepository = AppDataSource.getRepository(PayoutBatch);
      const batch = batchRepository.create({
        batchAt: new Date(),
        scheduledSendAt: new Date(),
        minPayoutUSD: 20,
        status: PayoutBatchStatus.REVIEWED, // Already reviewed
        totalAmountUSD: 100,
        totalAmountSOL: 0.5
      });
      const savedBatch = await batchRepository.save(batch);

      const req = {
        params: { batchId: savedBatch.id },
        headers: { 'x-admin-user': 'test-admin' }
      } as any;

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      } as any;

      await adminApprovePayoutBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('PREPARED status')
        })
      );

      // Clean up
      await batchRepository.remove(savedBatch);
    });
  });

  describe('adminSendPayoutBatch', () => {
    it('should require transaction signature', async () => {
      const req = {
        params: { batchId: 'test-id' },
        body: {}
      } as any;

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      } as any;

      await adminSendPayoutBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'transactionSignature is required'
        })
      );
    });

    it('should send approved batch', async () => {
      jest.spyOn(referralPayoutService, 'sendPayoutBatch').mockResolvedValue(undefined);

      const req = {
        params: { batchId: 'test-id' },
        body: { transactionSignature: 'test-signature' }
      } as any;

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      } as any;

      await adminSendPayoutBatch(req, res);

      expect(referralPayoutService.sendPayoutBatch).toHaveBeenCalledWith('test-id', 'test-signature');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });
  });
});


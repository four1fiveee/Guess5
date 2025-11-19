import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { Referral } from '../models/Referral';
import { ReferralEarning } from '../models/ReferralEarning';
import { PayoutBatch, PayoutBatchStatus } from '../models/PayoutBatch';
import { referralPayoutService } from '../services/payoutService';
import { ReferralService } from '../services/referralService';
import { AntiAbuseService } from '../services/antiAbuseService';
import { UserService } from '../services/userService';
import { getNextSunday1300EST } from '../utils/referralUtils';
import { notifyAdmin } from '../services/notificationService';
import * as fs from 'fs';
// csv-parse will be installed as dependency
let csv: any;
try {
  csv = require('csv-parse/sync');
} catch (e) {
  csv = null;
}

// Type for CSV record - supports both snake_case and camelCase
interface CSVRecord {
  referred_wallet?: string;
  referrer_wallet?: string;
  created_at?: string;
  referredWallet?: string;
  referrerWallet?: string;
  createdAt?: string;
}

/**
 * Admin endpoint to delete stuck matches
 * POST /api/admin/delete-match/:matchId
 * This is a simple endpoint that can be called directly
 */
export const adminDeleteMatch = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    console.log('🗑️ Admin deleting match:', matchId);
    
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    await matchRepository.remove(match);
    
    console.log('✅ Match deleted:', matchId);
    
    return res.json({
      success: true,
      message: 'Match deleted successfully',
      matchId,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to delete match:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

/**
 * Admin endpoint to backfill referrals from CSV
 * POST /api/admin/referral/backfill
 */
export const adminBackfillReferrals = async (req: Request, res: Response) => {
  try {
    if (!csv) {
      return res.status(500).json({ error: 'csv-parse package not installed. Run: npm install csv-parse' });
    }

    const { csvData, filePath } = req.body;

    let records: CSVRecord[] = [];

    if (filePath && fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      records = csv.parse(fileContent, {
        columns: true,
        skip_empty_lines: true
      });
    } else if (csvData) {
      records = csv.parse(csvData, {
        columns: true,
        skip_empty_lines: true
      });
    } else {
      return res.status(400).json({ error: 'Either csvData or filePath is required' });
    }

    const referralRepository = AppDataSource.getRepository(Referral);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        const referredWallet = record.referred_wallet || record.referredWallet;
        const referrerWallet = record.referrer_wallet || record.referrerWallet;
        const createdAt = record.created_at || record.createdAt || new Date();

        if (!referredWallet || !referrerWallet) {
          skipped++;
          continue;
        }

        // Check if already exists
        const existing = await referralRepository.findOne({
          where: { referredWallet }
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Prevent self-referral
        if (AntiAbuseService.detectSelfReferral(referredWallet, referrerWallet)) {
          errors.push(`Self-referral detected: ${referredWallet}`);
          skipped++;
          continue;
        }

        const referral = referralRepository.create({
          referredWallet,
          referrerWallet,
          referredAt: new Date(createdAt),
          eligible: false,
          active: true
        });

        await referralRepository.save(referral);
        imported++;
      } catch (error: any) {
        const wallet = (record as CSVRecord).referred_wallet || (record as CSVRecord).referredWallet || 'unknown';
        errors.push(`Error importing ${wallet}: ${error?.message || error}`);
      }
    }

    // Rebuild upline mapping
    await ReferralService.buildUplineMapping();

    // Recompute total entry fees for all users
    const userRepository = AppDataSource.getRepository('User');
    const users = await userRepository.find();
    for (const user of users) {
      await UserService.recomputeTotalEntryFees(user.walletAddress);
    }

    return res.json({
      success: true,
      imported,
      skipped,
      errors: errors.slice(0, 10) // Limit errors in response
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error backfilling referrals:', errorMessage);
    return res.status(500).json({ error: 'Failed to backfill referrals', details: errorMessage });
  }
};

/**
 * Get all owed referral amounts
 * GET /api/admin/referrals/owed
 */
export const adminGetOwedReferrals = async (req: Request, res: Response) => {
  try {
    const minPayout = parseFloat(req.query.minPayout as string) || 20;
    const payouts = await referralPayoutService.aggregateWeeklyPayouts(minPayout);

    // Get pending small payouts (< $20)
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const pendingSmall = await earningRepository.query(`
      SELECT 
        upline_wallet,
        SUM(amount_usd) as total_usd,
        COUNT(*) as match_count
      FROM referral_earning
      WHERE paid = false
        AND amount_usd IS NOT NULL
      GROUP BY upline_wallet
      HAVING SUM(amount_usd) < $1
      ORDER BY total_usd DESC
    `, [minPayout]);

    return res.json({
      success: true,
      owed: payouts,
      pendingSmall: pendingSmall.map((row: any) => ({
        uplineWallet: row.upline_wallet,
        totalUSD: parseFloat(row.total_usd),
        matchCount: parseInt(row.match_count)
      }))
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get owed referrals', details: errorMessage });
  }
};

/**
 * Prepare payout batch
 * POST /api/admin/payouts/prepare
 */
export const adminPreparePayoutBatch = async (req: Request, res: Response) => {
  try {
    const { scheduledSendAt, minPayoutUSD } = req.body;
    // Express Request has headers property, but TypeScript needs explicit typing
    const adminHeader = (req as any).headers?.['x-admin-user'] as string | undefined;
    const createdByAdmin = adminHeader || 'system';

    const sendAt = scheduledSendAt ? new Date(scheduledSendAt) : getNextSunday1300EST();
    const minPayout = minPayoutUSD || 20;

    const batch = await referralPayoutService.preparePayoutBatch(sendAt, minPayout, createdByAdmin);

    // Validate batch
    const validation = await referralPayoutService.validatePayoutBatch(batch.id);

    // Send notification
    await notifyAdmin({
      type: 'payout_batch_prepared',
      title: 'New Referral Payout Batch Prepared',
      message: `Payout batch ${batch.id} has been prepared with $${batch.totalAmountUSD.toFixed(2)} USD (${batch.totalAmountSOL.toFixed(6)} SOL). Please review and approve before payment.`,
      batchId: batch.id,
      totalAmountUSD: batch.totalAmountUSD,
      totalAmountSOL: batch.totalAmountSOL,
      scheduledSendAt: batch.scheduledSendAt,
      createdBy: createdByAdmin
    });

    return res.json({
      success: true,
      batch: {
        id: batch.id,
        totalAmountUSD: batch.totalAmountUSD,
        totalAmountSOL: batch.totalAmountSOL,
        status: batch.status,
        scheduledSendAt: batch.scheduledSendAt
      },
      validation,
      message: 'Batch prepared. Please review and approve before sending.'
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to prepare payout batch', details: errorMessage });
  }
};

/**
 * Approve payout batch (change status from PREPARED to REVIEWED)
 * POST /api/admin/payouts/approve/:batchId
 */
export const adminApprovePayoutBatch = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const adminHeader = (req as any).headers?.['x-admin-user'] as string | undefined;
    const reviewedByAdmin = adminHeader || 'unknown';

    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batch = await batchRepository.findOne({ where: { id: batchId } });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status !== PayoutBatchStatus.PREPARED) {
      return res.status(400).json({ 
        error: `Batch must be in PREPARED status to approve. Current status: ${batch.status}` 
      });
    }

    // Validate batch before approval
    const validation = await referralPayoutService.validatePayoutBatch(batchId);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Batch validation failed',
        validation
      });
    }

    // Update batch status to REVIEWED
    batch.status = PayoutBatchStatus.REVIEWED;
    batch.reviewedByAdmin = reviewedByAdmin;
    batch.reviewedAt = new Date();
    await batchRepository.save(batch);

    // Send notification
    await notifyAdmin({
      type: 'payout_batch_approved',
      title: 'Referral Payout Batch Approved',
      message: `Payout batch ${batchId} has been approved by ${reviewedByAdmin} and is ready to send.`,
      batchId: batch.id,
      totalAmountUSD: batch.totalAmountUSD,
      totalAmountSOL: batch.totalAmountSOL,
      reviewedBy: reviewedByAdmin
    });

    return res.json({
      success: true,
      message: 'Payout batch approved successfully',
      batch: {
        id: batch.id,
        status: batch.status,
        reviewedByAdmin: batch.reviewedByAdmin,
        reviewedAt: batch.reviewedAt
      },
      validation
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to approve payout batch', details: errorMessage });
  }
};

/**
 * Send payout batch (execute transaction)
 * POST /api/admin/payouts/send/:batchId
 * Requires batch to be in REVIEWED status (approved)
 */
export const adminSendPayoutBatch = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const { transactionSignature } = req.body;

    if (!transactionSignature) {
      return res.status(400).json({ error: 'transactionSignature is required' });
    }

    await referralPayoutService.sendPayoutBatch(batchId, transactionSignature);

    // Send notification
    await notifyAdmin({
      type: 'payout_batch_sent',
      title: 'Referral Payout Batch Sent',
      message: `Payout batch ${batchId} has been sent with transaction ${transactionSignature}.`,
      batchId,
      transactionSignature
    });

    return res.json({
      success: true,
      message: 'Payout batch sent successfully'
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to send payout batch', details: errorMessage });
  }
};

/**
 * Get all payout batches
 * GET /api/admin/payouts/batches
 */
export const adminGetPayoutBatches = async (req: Request, res: Response) => {
  try {
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batches = await batchRepository.find({
      order: { createdAt: 'DESC' },
      take: 50
    });

    return res.json({
      success: true,
      batches: batches.map(b => ({
        id: b.id,
        batchAt: b.batchAt,
        scheduledSendAt: b.scheduledSendAt,
        status: b.status,
        totalAmountUSD: b.totalAmountUSD,
        totalAmountSOL: b.totalAmountSOL,
        transactionSignature: b.transactionSignature,
        createdAt: b.createdAt
      }))
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get payout batches', details: errorMessage });
  }
};

/**
 * Get payout batch details
 * GET /api/admin/payouts/batch/:id
 */
export const adminGetPayoutBatch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batch = await batchRepository.findOne({ where: { id } });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const earnings = await earningRepository.find({
      where: { payoutBatchId: id }
    });

    const validation = await referralPayoutService.validatePayoutBatch(id);

    return res.json({
      success: true,
      batch,
      earningsCount: earnings.length,
      validation
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get payout batch', details: errorMessage });
  }
};

/**
 * Get abuse flags
 * GET /api/admin/referrals/abuse-flags
 */
export const adminGetAbuseFlags = async (req: Request, res: Response) => {
  try {
    const flags = await AntiAbuseService.getAbuseFlags();
    return res.json({
      success: true,
      flags
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get abuse flags', details: errorMessage });
  }
};










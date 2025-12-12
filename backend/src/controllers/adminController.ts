import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { Referral } from '../models/Referral';
import { ReferralEarning } from '../models/ReferralEarning';
import { PayoutBatch, PayoutBatchStatus } from '../models/PayoutBatch';
import { User } from '../models/User';
import { referralPayoutService } from '../services/payoutService';
import { ReferralService } from '../services/referralService';
import { AntiAbuseService } from '../services/antiAbuseService';
import { getRedisMM } from '../config/redis';
import { forceReleaseLock, checkLockStatus, cleanupStaleLocks, getLockStats } from '../utils/proposalLocks';
import { UserService } from '../services/userService';
import { getNextSunday1300EST, isWithinLockWindow, isWithinExecuteWindow, getCurrentEST, getTimeUntilLockWindow } from '../utils/referralUtils';
import { PayoutLock } from '../models/PayoutLock';
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
    
    // Use delete instead of remove to avoid loading relations
    // This is faster and avoids timeout issues
    const deleteResult = await matchRepository.delete({ id: matchId });
    
    if (deleteResult.affected === 0) {
      return res.status(404).json({ error: 'Match not found or already deleted' });
    }
    
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
 * Admin endpoint to delete all matches (for testing/cleanup)
 * POST /api/admin/delete-all-matches
 */
export const adminDeleteAllMatches = async (req: Request, res: Response) => {
  try {
    console.log('🗑️ Admin deleting all matches...');
    
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get count before deletion
    const countBefore = await matchRepository.count();
    
    // Delete all matches
    await matchRepository.query(`DELETE FROM "match"`);
    
    console.log(`✅ Deleted ${countBefore} matches`);
    
    return res.json({
      success: true,
      message: `Deleted ${countBefore} matches successfully`,
      deletedCount: countBefore,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to delete all matches:', errorMessage);
    
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

/**
 * Get list of exempt players
 * GET /api/admin/referrals/exempt-list
 */
export const adminGetExemptList = async (req: Request, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    
    const exemptUsers = await userRepository.find({
      where: { exemptFromReferralMinimum: true },
      order: { updatedAt: 'DESC' }
    });

    // Get match counts for exempt users
    const exemptList = await Promise.all(
      exemptUsers.map(async (user) => {
        const matchCount = await UserService.getMatchCount(user.walletAddress);
        return {
          walletAddress: user.walletAddress,
          username: user.username,
          matchCount,
          totalEntryFeesUSD: Number(user.totalEntryFees),
          exemptedAt: user.updatedAt
        };
      })
    );

    return res.json({
      success: true,
      exemptList,
      count: exemptList.length
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get exempt list', details: errorMessage });
  }
};

/**
 * Add player to exempt list
 * POST /api/admin/referrals/exempt
 */
export const adminAddExempt = async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const user = await UserService.getUserByWallet(walletAddress);
    const userRepository = AppDataSource.getRepository(User);

    user.exemptFromReferralMinimum = true;
    await userRepository.save(user);

    const matchCount = await UserService.getMatchCount(walletAddress);

    return res.json({
      success: true,
      message: `Player ${walletAddress} added to exempt list`,
      user: {
        walletAddress: user.walletAddress,
        username: user.username,
        matchCount,
        exemptFromReferralMinimum: user.exemptFromReferralMinimum
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to add exempt player', details: errorMessage });
  }
};

/**
 * Remove player from exempt list
 * POST /api/admin/referrals/remove-exempt
 */
export const adminRemoveExempt = async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const user = await UserService.getUserByWallet(walletAddress);
    const userRepository = AppDataSource.getRepository(User);

    user.exemptFromReferralMinimum = false;
    await userRepository.save(user);

    const matchCount = await UserService.getMatchCount(walletAddress);
    const canReferCheck = await UserService.canReferOthers(walletAddress);

    return res.json({
      success: true,
      message: `Player ${walletAddress} removed from exempt list`,
      user: {
        walletAddress: user.walletAddress,
        username: user.username,
        matchCount,
        exemptFromReferralMinimum: user.exemptFromReferralMinimum,
        canReferOthers: canReferCheck.canRefer,
        reason: canReferCheck.reason
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to remove exempt player', details: errorMessage });
  }
};

// Clear Redis proposal lock for a match (emergency admin function)
export const adminClearProposalLock = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    console.log('🔧 Admin clearing proposal lock for match:', matchId);
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required' });
    }
    
    // Clear the Redis lock using the enhanced force release function
    const result = await forceReleaseLock(matchId);
    
    console.log('✅ Proposal lock cleared:', {
      matchId,
      success: result,
    });
    
    return res.json({
      success: true,
      message: 'Proposal lock cleared successfully',
      matchId,
      lockCleared: result,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to clear proposal lock:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

// Clear Redis proposal lock AND delete match (emergency recovery function)
export const adminClearLockAndDeleteMatch = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    console.log('🔧 Admin clearing proposal lock and deleting match:', matchId);
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required' });
    }
    
    // Step 1: Clear the Redis lock using enhanced force release
    const lockResult = await forceReleaseLock(matchId);
    
    console.log('✅ Proposal lock cleared:', {
      matchId,
      success: lockResult,
    });
    
    // Step 2: Delete the match from database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (match) {
      await matchRepository.remove(match);
      console.log('✅ Match deleted from database:', matchId);
    } else {
      console.log('⚠️ Match not found in database:', matchId);
    }
    
    return res.json({
      success: true,
      message: 'Proposal lock cleared and match deleted successfully',
      matchId,
      lockCleared: lockResult,
      matchDeleted: !!match,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to clear lock and delete match:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

// Get Redis lock statistics (admin monitoring)
export const adminGetLockStats = async (req: Request, res: Response) => {
  try {
    console.log('📊 Admin requesting lock statistics');
    
    const stats = await getLockStats();
    
    console.log('✅ Lock statistics retrieved:', stats);
    
    return res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to get lock statistics:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

// Check specific lock status (admin debugging)
export const adminCheckLockStatus = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    console.log('🔍 Admin checking lock status for match:', matchId);
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required' });
    }
    
    const status = await checkLockStatus(matchId);
    
    console.log('✅ Lock status retrieved:', { matchId, status });
    
    return res.json({
      success: true,
      matchId,
      lockStatus: status,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to check lock status:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

// Cleanup all stale locks (admin maintenance)
export const adminCleanupStaleLocks = async (req: Request, res: Response) => {
  try {
    console.log('🧹 Admin initiating stale lock cleanup');
    
    const cleanedCount = await cleanupStaleLocks();
    
    console.log('✅ Stale lock cleanup completed:', { cleanedCount });
    
    return res.json({
      success: true,
      message: 'Stale lock cleanup completed',
      cleanedCount,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to cleanup stale locks:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

/**
 * Admin endpoint to manually execute a proposal (emergency recovery tool)
 * POST /api/admin/execute-proposal/:matchId
 * 
 * SECURITY: This endpoint should be protected with admin authentication in production.
 * THROTTLING: Rate-limited to prevent abuse (max 1 execution per match per minute).
 * AUDIT: All execution attempts are logged with admin identity and timestamp.
 */
const executionThrottle = new Map<string, number>(); // matchId -> last execution timestamp
const THROTTLE_WINDOW_MS = 60 * 1000; // 1 minute

export const adminExecuteProposal = async (req: Request, res: Response) => {
  const startTime = Date.now();
  const adminId = (req as any).user?.id || (req as any).adminId || 'unknown'; // TODO: Add proper admin auth
  const auditTrail: any[] = [];
  
  try {
    const { matchId } = req.params;
    
    const reqAny = req as any;
    auditTrail.push({
      action: 'admin_execute_proposal_requested',
      matchId,
      adminId,
      timestamp: new Date().toISOString(),
      ip: reqAny.ip || reqAny.headers?.['x-forwarded-for'] || reqAny.headers?.['x-real-ip'] || 'unknown',
    });
    
    console.log('🔧 Admin manual execution requested', { matchId, adminId });
    
    // Throttling check
    const lastExecution = executionThrottle.get(matchId);
    const now = Date.now();
    if (lastExecution && (now - lastExecution) < THROTTLE_WINDOW_MS) {
      const remainingMs = THROTTLE_WINDOW_MS - (now - lastExecution);
      auditTrail.push({
        action: 'throttled',
        remainingMs,
        timestamp: new Date().toISOString(),
      });
      
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Execution throttled. Please wait ${Math.ceil(remainingMs / 1000)} seconds before retrying.`,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        auditTrail,
      });
    }
    
    // Update throttle
    executionThrottle.set(matchId, now);
    
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      auditTrail.push({
        action: 'match_not_found',
        timestamp: new Date().toISOString(),
      });
      return res.status(404).json({ error: 'Match not found', auditTrail });
    }
    
    // Validate match state
    if (!match.squadsVaultAddress || !match.payoutProposalId) {
      auditTrail.push({
        action: 'invalid_match_state',
        hasVault: !!match.squadsVaultAddress,
        hasProposal: !!match.payoutProposalId,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({
        error: 'Invalid match state',
        message: 'Match does not have vault address or proposal ID',
        auditTrail,
      });
    }
    
    auditTrail.push({
      action: 'execution_started',
      vaultAddress: match.squadsVaultAddress,
      proposalId: match.payoutProposalId,
      timestamp: new Date().toISOString(),
    });
    
    // Import squadsVaultService
    const { squadsVaultService } = require('../services/squadsVaultService');
    const { getFeeWallet } = require('../config/solana');
    
    const executor = getFeeWallet();
    
    // Execute proposal
    const executeResult = await squadsVaultService.executeProposal(
      match.squadsVaultAddress,
      match.payoutProposalId,
      executor
    );
    
    const executionTime = Date.now() - startTime;
    
    auditTrail.push({
      action: 'execution_completed',
      success: executeResult.success,
      signature: executeResult.signature,
      error: executeResult.error,
      errorCode: executeResult.errorCode,
      attempts: executeResult.attempts,
      executionTimeMs: executionTime,
      timestamp: new Date().toISOString(),
    });
    
    // Update match record with execution attempt
    if (executeResult.signature) {
      await matchRepository.update(matchId, {
        proposalTransactionId: executeResult.signature,
        executionAttempts: (match.executionAttempts || 0) + 1,
        executionLastAttemptAt: new Date(),
      });
    } else {
      await matchRepository.update(matchId, {
        executionAttempts: (match.executionAttempts || 0) + 1,
        executionLastAttemptAt: new Date(),
      });
    }
    
    // Log audit trail
    console.log('📋 ADMIN EXECUTION AUDIT TRAIL', {
      matchId,
      adminId,
      auditTrail,
      duration: executionTime,
    });
    
    if (executeResult.success) {
      return res.json({
        success: true,
        message: 'Proposal executed successfully',
        signature: executeResult.signature,
        executedAt: executeResult.executedAt,
        auditTrail,
        executionTimeMs: executionTime,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: executeResult.error,
        errorCode: executeResult.errorCode,
        attempts: executeResult.attempts,
        auditTrail,
        executionTimeMs: executionTime,
      });
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const executionTime = Date.now() - startTime;
    
    auditTrail.push({
      action: 'execution_failed',
      error: errorMessage,
      timestamp: new Date().toISOString(),
      executionTimeMs: executionTime,
    });
    
    console.error('❌ Admin execution failed:', {
      matchId: req.params.matchId,
      adminId,
      error: errorMessage,
      auditTrail,
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      details: errorMessage,
      auditTrail,
      executionTimeMs: executionTime,
    });
  }
};

/**
 * Get health status for Vercel and Render
 * GET /api/admin/health/status
 */
export const adminGetHealthStatus = async (req: Request, res: Response) => {
  try {
    const axios = require('axios');
    const vercelStatus = {
      status: 'unknown' as 'up' | 'down' | 'unknown',
      lastChecked: new Date().toISOString(),
      url: 'https://guess5.io',
    };

    const renderStatus = {
      status: 'unknown' as 'up' | 'down' | 'unknown',
      lastChecked: new Date().toISOString(),
      url: 'https://guess5.onrender.com',
    };

    // Check Vercel (frontend) - use GET instead of HEAD as some servers don't support HEAD
    try {
      const vercelResponse = await axios.get('https://guess5.io', { 
        timeout: 5000,
        validateStatus: (status: number) => status < 500 // Accept any status < 500 as "up"
      });
      vercelStatus.status = vercelResponse.status < 500 ? 'up' : 'down';
    } catch (err: any) {
      console.warn('Vercel health check failed:', err.message);
      vercelStatus.status = 'down';
    }

    // Check Render (backend)
    try {
      const renderResponse = await axios.get('https://guess5.onrender.com/health', { 
        timeout: 5000
      });
      renderStatus.status = renderResponse.status === 200 ? 'up' : 'down';
    } catch (err) {
      renderStatus.status = 'down';
    }

    return res.json({
      success: true,
      vercel: vercelStatus,
      render: renderStatus,
      overall: vercelStatus.status === 'up' && renderStatus.status === 'up' ? 'up' : 'down',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get health status', details: errorMessage });
  }
};

/**
 * Get financial metrics (YTD, QTD, weekly)
 * GET /api/admin/financial/metrics
 */
export const adminGetFinancialMetrics = async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const matchRepository = AppDataSource.getRepository(Match);
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfQuarter = new Date(now);
    const currentQuarter = Math.floor(now.getMonth() / 3);
    startOfQuarter.setMonth(currentQuarter * 3, 1);
    startOfQuarter.setHours(0, 0, 0, 0);

    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Get current SOL price for USD conversion
    const axios = require('axios');
    let currentSolPriceUSD = 0;
    try {
      const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      currentSolPriceUSD = priceResponse.data.solana?.usd || 0;
    } catch (err) {
      console.warn('Failed to fetch SOL price for financial metrics:', err);
    }

    // Get all matches with payments and financial data
    const allMatches = await matchRepository.query(`
      SELECT 
        "entryFee",
        "entryFeeUSD",
        "payoutAmount",
        "payoutAmountUSD",
        "bonusAmount",
        "bonusAmountUSD",
        "platformFee",
        "squadsCost",
        "squadsCostUSD",
        "netProfit",
        "netProfitUSD",
        "player1Paid",
        "player2Paid",
        "createdAt",
        "isCompleted",
        status,
        winner,
        "proposalExecutedAt"
      FROM "match"
      WHERE ("player1Paid" = true OR "player2Paid" = true)
        AND "createdAt" >= $1
      ORDER BY "createdAt" DESC
    `, [startOfYear]);

    const calculateMetrics = (matches: any[], startDate: Date, solPriceUSD: number) => {
      const filtered = matches.filter(m => new Date(m.createdAt) >= startDate);
      
      let matchesPlayed = 0;
      let totalEntryFees = 0;
      let totalPlatformFee = 0;
      let totalBonus = 0;
      let totalSquadsCost = 0;
      let totalGasCost = 0; // Estimated gas costs
      let totalPayouts = 0;

      for (const match of filtered) {
        const entryFee = parseFloat(match.entryFee) || 0;
        
        // Count entry fees (both players pay)
        if (match.player1Paid && match.player2Paid) {
          totalEntryFees += entryFee * 2;
        } else if (match.player1Paid || match.player2Paid) {
          totalEntryFees += entryFee;
        }

        // Count completed matches
        if (match.isCompleted || match.status === 'completed') {
          matchesPlayed++;
          
          // Platform fee (5% of total pot = entryFee * 2 * 0.05)
          const platformFee = parseFloat(match.platformFee) || (entryFee * 2 * 0.05);
          totalPlatformFee += platformFee;

          // Bonus amount
          const bonusAmount = parseFloat(match.bonusAmount) || 0;
          totalBonus += bonusAmount;

          // Squads cost
          const squadsCost = parseFloat(match.squadsCost) || 0;
          totalSquadsCost += squadsCost;

          // Estimate gas costs (roughly 0.001 SOL per transaction)
          const estimatedGas = 0.001; // Conservative estimate
          totalGasCost += estimatedGas;
          
          // Count payouts (winners get payout, ties get refund)
          if (match.winner === 'tie' && match.proposalExecutedAt) {
            // Both players get refund
            totalPayouts += entryFee * 2;
          } else if (match.winner && match.proposalExecutedAt) {
            const payoutAmount = parseFloat(match.payoutAmount) || 0;
            totalPayouts += payoutAmount;
          }
        }
      }

      // Net profit = Platform fee - Bonus - Squads cost - Gas (calculate in SOL first)
      const netProfitSOL = totalPlatformFee - totalBonus - totalSquadsCost - totalGasCost;
      
      // Convert all SOL amounts to USD using current exchange rate
      const totalEntryFeesUSD = totalEntryFees * solPriceUSD;
      const totalPlatformFeeUSD = totalPlatformFee * solPriceUSD;
      const totalBonusUSD = totalBonus * solPriceUSD;
      const totalSquadsCostUSD = totalSquadsCost * solPriceUSD;
      const totalGasCostUSD = totalGasCost * solPriceUSD;
      const totalPayoutsUSD = totalPayouts * solPriceUSD;
      const netProfitUSD = netProfitSOL * solPriceUSD;

      return {
        matchesPlayed,
        // SOL amounts (actual amounts exchanged)
        totalEntryFeesSOL: parseFloat(totalEntryFees.toFixed(6)),
        totalPlatformFeeSOL: parseFloat(totalPlatformFee.toFixed(6)),
        totalBonusSOL: parseFloat(totalBonus.toFixed(6)),
        totalSquadsCostSOL: parseFloat(totalSquadsCost.toFixed(6)),
        totalGasCostSOL: parseFloat(totalGasCost.toFixed(6)),
        totalPayoutsSOL: parseFloat(totalPayouts.toFixed(6)),
        netProfitSOL: parseFloat(netProfitSOL.toFixed(6)),
        // USD amounts (converted at current exchange rate)
        totalEntryFeesUSD: parseFloat(totalEntryFeesUSD.toFixed(2)),
        totalPlatformFeeUSD: parseFloat(totalPlatformFeeUSD.toFixed(2)),
        totalBonusUSD: parseFloat(totalBonusUSD.toFixed(2)),
        totalSquadsCostUSD: parseFloat(totalSquadsCostUSD.toFixed(2)),
        totalGasCostUSD: parseFloat(totalGasCostUSD.toFixed(2)),
        totalPayoutsUSD: parseFloat(totalPayoutsUSD.toFixed(2)),
        netProfitUSD: parseFloat(netProfitUSD.toFixed(2)),
        currentSolPriceUSD: parseFloat(currentSolPriceUSD.toFixed(2)),
      };
    };

    const weekly = calculateMetrics(allMatches, startOfWeek, currentSolPriceUSD);
    const quarterly = calculateMetrics(allMatches, startOfQuarter, currentSolPriceUSD);
    const yearly = calculateMetrics(allMatches, startOfYear, currentSolPriceUSD);

    return res.json({
      success: true,
      weekly,
      quarterly,
      yearly,
      currentSolPriceUSD: parseFloat(currentSolPriceUSD.toFixed(2)),
      period: {
        weekStart: startOfWeek.toISOString(),
        quarterStart: startOfQuarter.toISOString(),
        yearStart: startOfYear.toISOString(),
        currentDate: now.toISOString(),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get financial metrics', details: errorMessage });
  }
};

/**
 * Download financial CSV report with date filtering
 * GET /api/admin/financial/csv?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const adminGetFinancialCSV = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
    }

    // Use the existing generateReportHandler logic but ensure it includes all financial data
    const { generateReportHandler } = require('./matchController');
    
    // Create a mock request/response object for the handler
    const mockReq: any = {
      query: { startDate, endDate },
    };
    
    const mockRes: any = {
      setHeader: (name: string, value: string) => {
        (res as any).setHeader(name, value);
      },
      send: (data: string) => {
        res.send(data);
      },
    };
    
    await generateReportHandler(mockReq, mockRes);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error generating admin financial CSV:', errorMessage);
    return res.status(500).json({ error: 'Failed to generate CSV', details: errorMessage });
  }
};

/**
 * Get fee wallet balance
 * GET /api/admin/financial/fee-wallet-balance
 */
export const adminGetFeeWalletBalance = async (req: Request, res: Response) => {
  try {
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const { getFeeWalletAddress } = require('../config/wallet');
    
    const networkUrl = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
    const connection = new Connection(networkUrl, 'confirmed');
    const feeWalletAddress = getFeeWalletAddress();
    const feeWalletPublicKey = new PublicKey(feeWalletAddress);
    
    const balance = await connection.getBalance(feeWalletPublicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    // Get current SOL price (simplified - you might want to cache this)
    const axios = require('axios');
    let solPriceUSD = 0;
    try {
      const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      solPriceUSD = priceResponse.data.solana?.usd || 0;
    } catch (err) {
      console.warn('Failed to fetch SOL price:', err);
    }

    return res.json({
      success: true,
      wallet: feeWalletAddress,
      balanceSOL: parseFloat(balanceSOL.toFixed(6)),
      balanceUSD: parseFloat((balanceSOL * solPriceUSD).toFixed(2)),
      solPriceUSD: parseFloat(solPriceUSD.toFixed(2)),
      lastChecked: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get fee wallet balance', details: errorMessage });
  }
};

/**
 * Get referral payout execution data
 * GET /api/admin/referrals/payout-execution
 */
export const adminGetReferralPayoutExecution = async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const batchRepository = AppDataSource.getRepository(PayoutBatch);

    // Get current amount owed - handle case where table might not exist
    let owedResult: any[] = [];
    let totalOwedUSD = 0;
    let totalOwedSOL = 0;
    
    try {
      owedResult = await earningRepository.query(`
        SELECT 
          upline_wallet,
          SUM(amount_usd) as total_usd,
          SUM(amount_sol) as total_sol,
          COUNT(*) as match_count
        FROM referral_earning
        WHERE paid = false
          AND amount_usd IS NOT NULL
        GROUP BY upline_wallet
        ORDER BY total_usd DESC
      `);
      totalOwedUSD = owedResult.reduce((sum: number, row: any) => sum + parseFloat(row.total_usd || 0), 0);
      totalOwedSOL = owedResult.reduce((sum: number, row: any) => sum + parseFloat(row.total_sol || 0), 0);
    } catch (err: any) {
      console.warn('Failed to query referral earnings (table may not exist):', err.message);
      // Continue with empty results
    }

    // Get paid referrals
    let paidResult: any[] = [];
    let totalPaidUSD = 0;
    let totalPaidSOL = 0;
    
    try {
      paidResult = await earningRepository.query(`
        SELECT 
          upline_wallet,
          SUM(amount_usd) as total_usd,
          SUM(amount_sol) as total_sol,
          COUNT(*) as match_count
        FROM referral_earning
        WHERE paid = true
          AND amount_usd IS NOT NULL
        GROUP BY upline_wallet
        ORDER BY total_usd DESC
      `);
      totalPaidUSD = paidResult.reduce((sum: number, row: any) => sum + parseFloat(row.total_usd || 0), 0);
      totalPaidSOL = paidResult.reduce((sum: number, row: any) => sum + parseFloat(row.total_sol || 0), 0);
    } catch (err: any) {
      console.warn('Failed to query paid referrals:', err.message);
      // Continue with empty results
    }

    // Get historical payouts (from batches)
    let batches: any[] = [];
    try {
      batches = await batchRepository.find({
        where: { status: PayoutBatchStatus.SENT },
        order: { createdAt: 'DESC' },
        take: 20,
      });
    } catch (err: any) {
      console.warn('Failed to query payout batches:', err.message);
      // Continue with empty results
    }

    return res.json({
      success: true,
      currentOwed: {
        totalUSD: parseFloat(totalOwedUSD.toFixed(2)),
        totalSOL: parseFloat(totalOwedSOL.toFixed(6)),
        count: owedResult.length,
        breakdown: owedResult.map((row: any) => ({
          uplineWallet: row.upline_wallet,
          totalUSD: parseFloat(row.total_usd || 0),
          totalSOL: parseFloat(row.total_sol || 0),
          matchCount: parseInt(row.match_count || 0),
        })),
      },
      totalPaid: {
        totalUSD: parseFloat(totalPaidUSD.toFixed(2)),
        totalSOL: parseFloat(totalPaidSOL.toFixed(6)),
        count: paidResult.length,
      },
      historicalPayouts: batches.map((batch: any) => ({
        id: batch.id,
        totalAmountUSD: batch.totalAmountUSD,
        totalAmountSOL: batch.totalAmountSOL,
        status: batch.status,
        createdAt: batch.createdAt,
        executedAt: batch.status === 'SENT' ? batch.updatedAt : null,
        recipientCount: 0, // TODO: Calculate from batch items if needed
      })),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in adminGetReferralPayoutExecution:', errorMessage);
    return res.status(500).json({ 
      error: 'Failed to get referral payout execution data', 
      details: errorMessage,
      note: 'Some tables may not exist yet. This is normal for new installations.'
    });
  }
};

/**
 * Lock referrals for the week (to ensure referrals during payout review are tracked for next week)
 * POST /api/admin/referrals/lock-week
 * Only available Sunday 9am-9pm EST
 */
export const adminLockReferralsWeek = async (req: Request, res: Response) => {
  try {
    // Check if within lock window (Sunday 9am-9pm EST)
    if (!isWithinLockWindow()) {
      const estNow = getCurrentEST();
      const timeUntil = getTimeUntilLockWindow();
      return res.status(400).json({ 
        error: 'Lock window is only available on Sunday between 9am-9pm EST',
        currentTime: estNow.toISOString(),
        timeUntilNextWindow: timeUntil,
        note: 'If you miss the lock window, funds will roll over to next week'
      });
    }

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const lockRepository = AppDataSource.getRepository(PayoutLock);
    const estNow = getCurrentEST();
    
    // Get current Sunday date (lock date)
    const lockDate = new Date(estNow);
    lockDate.setHours(0, 0, 0, 0); // Start of Sunday

    // Check if lock already exists for this Sunday
    const existingLock = await lockRepository.findOne({
      where: { lockDate },
    });

    if (existingLock && existingLock.executedAt) {
      return res.status(400).json({ 
        error: 'Payout for this week has already been executed',
        lockId: existingLock.id,
        executedAt: existingLock.executedAt
      });
    }

    if (existingLock) {
      return res.json({
        success: true,
        message: 'Lock already exists for this week',
        lock: {
          id: existingLock.id,
          lockDate: existingLock.lockDate,
          lockedAt: existingLock.lockedAt,
          totalAmountUSD: existingLock.totalAmountUSD,
          totalAmountSOL: existingLock.totalAmountSOL,
          referrerCount: existingLock.referrerCount,
        },
        countdownExpiresAt: existingLock.lockedAt ? new Date(existingLock.lockedAt.getTime() + 2 * 60 * 60 * 1000).toISOString() : null,
      });
    }

    // Get all unpaid referrals
    const unpaidResult = await earningRepository.query(`
      SELECT 
        SUM(amount_usd) as total_usd,
        SUM(amount_sol) as total_sol,
        COUNT(DISTINCT upline_wallet) as referrer_count
      FROM referral_earning
      WHERE paid = false
        AND amount_usd IS NOT NULL
    `);

    const totalUSD = parseFloat(unpaidResult[0]?.total_usd || 0);
    const totalSOL = parseFloat(unpaidResult[0]?.total_sol || 0);
    const referrerCount = parseInt(unpaidResult[0]?.referrer_count || 0);

    // Create lock
    const lock = lockRepository.create({
      lockDate,
      totalAmountUSD: totalUSD,
      totalAmountSOL: totalSOL,
      referrerCount,
      lockedAt: new Date(),
    });

    const savedLock = await lockRepository.save(lock);

    const countdownExpiresAt = new Date(savedLock.lockedAt!.getTime() + 2 * 60 * 60 * 1000); // 2 hours from lock

    return res.json({
      success: true,
      message: `Locked ${referrerCount} referrers with $${totalUSD.toFixed(2)} USD for payout`,
      lock: {
        id: savedLock.id,
        lockDate: savedLock.lockDate,
        lockedAt: savedLock.lockedAt,
        totalAmountUSD: savedLock.totalAmountUSD,
        totalAmountSOL: savedLock.totalAmountSOL,
        referrerCount: savedLock.referrerCount,
      },
      countdownExpiresAt: countdownExpiresAt.toISOString(),
      note: 'You have 2 hours to review and execute. After 2 hours, payout will auto-execute.',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error locking referrals:', errorMessage);
    return res.status(500).json({ error: 'Failed to lock referrals week', details: errorMessage });
  }
};

/**
 * Execute locked payout
 * POST /api/admin/referrals/execute-payout
 * Only available Sunday 9am-9pm EST, requires auto-lock to exist
 */
export const adminExecutePayout = async (req: Request, res: Response) => {
  try {
    // Check if within execute window (Sunday 9am-9pm EST)
    if (!isWithinExecuteWindow()) {
      return res.status(400).json({ 
        error: 'Execute window is only available on Sunday between 9am-9pm EST',
        currentTime: getCurrentEST().toISOString(),
      });
    }

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const lockRepository = AppDataSource.getRepository(PayoutLock);
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const estNow = getCurrentEST();
    
    // Get current Sunday date
    const lockDate = new Date(estNow);
    lockDate.setHours(0, 0, 0, 0);

    // Find lock for this Sunday
    const lock = await lockRepository.findOne({
      where: { lockDate },
    });

    if (!lock) {
      return res.status(400).json({ 
        error: 'No auto-lock found for this week. Payouts are auto-locked at 12:00am Sunday EST.',
        note: 'Only referrers with >= $10 USD owed are included in the payout.'
      });
    }

    if (lock.executedAt) {
      return res.status(400).json({ 
        error: 'Payout for this week has already been executed',
        executedAt: lock.executedAt,
        transactionSignature: lock.transactionSignature
      });
    }

    // Prepare payout batch using locked amounts (only >= $10 USD referrers)
    const adminHeader = (req as any).headers?.['x-admin-user'] as string | undefined;
    const executedByAdmin = adminHeader || 'admin';
    
    const sendAt = new Date(); // Execute immediately
    // Use $10 minimum threshold to match auto-lock criteria
    const batch = await referralPayoutService.preparePayoutBatch(sendAt, 10, executedByAdmin);

    // Approve batch
    batch.status = PayoutBatchStatus.REVIEWED;
    batch.reviewedByAdmin = executedByAdmin;
    batch.reviewedAt = new Date();
    await batchRepository.save(batch);

    // Generate transaction
    const transaction = await referralPayoutService.generateBatchTransaction(batch.id);

    // For now, return transaction for admin to sign
    // In production, you might want to auto-sign if using a hot wallet
    const transactionBuffer = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Update lock
    lock.executedAt = new Date();
    lock.executedByAdmin = executedByAdmin;
    lock.autoExecuted = false; // Manual execution
    await lockRepository.save(lock);

    return res.json({
      success: true,
      message: 'Payout transaction prepared',
      lock: {
        id: lock.id,
        executedAt: lock.executedAt,
        autoExecuted: lock.autoExecuted,
      },
      batch: {
        id: batch.id,
        totalAmountUSD: batch.totalAmountUSD,
        totalAmountSOL: batch.totalAmountSOL,
      },
      transaction: {
        buffer: Array.from(transactionBuffer),
        note: 'Transaction needs to be signed and sent. Use sendPayoutBatch endpoint with transaction signature.',
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error executing payout:', errorMessage);
    return res.status(500).json({ error: 'Failed to execute payout', details: errorMessage });
  }
};

/**
 * Get payout lock status
 * GET /api/admin/referrals/payout-lock-status
 */
export const adminGetPayoutLockStatus = async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const lockRepository = AppDataSource.getRepository(PayoutLock);
    const estNow = getCurrentEST();
    
    // Get current Sunday date
    const lockDate = new Date(estNow);
    lockDate.setHours(0, 0, 0, 0);

    // Find lock for this Sunday
    const lock = await lockRepository.findOne({
      where: { lockDate },
      order: { createdAt: 'DESC' },
    });

    const isLockWindow = isWithinLockWindow();
    const isExecuteWindow = isWithinExecuteWindow();
    const countdownExpiresAt = lock?.lockedAt ? new Date(lock.lockedAt.getTime() + 2 * 60 * 60 * 1000) : null;
    const countdownRemaining = countdownExpiresAt && countdownExpiresAt > new Date() 
      ? Math.max(0, Math.floor((countdownExpiresAt.getTime() - new Date().getTime()) / 1000))
      : null;

    return res.json({
      success: true,
      lock: lock ? {
        id: lock.id,
        lockDate: lock.lockDate,
        lockedAt: lock.lockedAt,
        executedAt: lock.executedAt,
        totalAmountUSD: lock.totalAmountUSD,
        totalAmountSOL: lock.totalAmountSOL,
        referrerCount: lock.referrerCount,
        autoExecuted: lock.autoExecuted,
        transactionSignature: lock.transactionSignature,
      } : null,
      windows: {
        isLockWindow,
        isExecuteWindow,
        currentTimeEST: estNow.toISOString(),
      },
      countdown: countdownRemaining !== null ? {
        expiresAt: countdownExpiresAt?.toISOString(),
        remainingSeconds: countdownRemaining,
        expired: countdownRemaining === 0,
      } : null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Failed to get payout lock status', details: errorMessage });
  }
};

/**
 * Download referral payout history CSV report with date filtering
 * GET /api/admin/referrals/payout-history/csv?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const adminGetReferralPayoutHistoryCSV = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
    }

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const { PayoutBatch } = require('../models/PayoutBatch');
    const { ReferralEarning } = require('../models/ReferralEarning');
    const payoutBatchRepository = AppDataSource.getRepository(PayoutBatch);
    const referralEarningRepository = AppDataSource.getRepository(ReferralEarning);

    // Query payout batches within date range
    const payoutBatches = await payoutBatchRepository.query(`
      SELECT 
        pb.id,
        pb."createdAt",
        pb."updatedAt",
        pb.status,
        pb."transactionSignature",
        pb."totalAmountSOL",
        pb."totalAmountUSD",
        COUNT(DISTINCT re."uplineWallet") as "recipientCount",
        COUNT(re.id) as "earningCount"
      FROM payout_batch pb
      LEFT JOIN referral_earning re ON re."payoutBatchId" = pb.id
      WHERE DATE(pb."createdAt") >= $1 
        AND DATE(pb."createdAt") <= $2
      GROUP BY pb.id, pb."createdAt", pb."updatedAt", pb.status, pb."transactionSignature", 
               pb."totalAmountSOL", pb."totalAmountUSD"
      ORDER BY pb."createdAt" DESC
    `, [startDate, endDate]);

    // Get detailed earnings for each batch
    const batchIds = payoutBatches.map((pb: any) => pb.id);
    const allEarnings = batchIds.length > 0 ? await referralEarningRepository.query(`
      SELECT 
        re.id,
        re."uplineWallet",
        re."downlineWallet",
        re."matchId",
        re."amountSOL",
        re."amountUSD",
        re."tierName",
        re."tier",
        re."percentage",
        re."bothPlayersReferred",
        re."createdAt",
        re."payoutBatchId",
        pb."createdAt" as "payoutCreatedAt",
        pb.status as "payoutStatus",
        pb."transactionSignature" as "payoutTransactionSignature"
      FROM referral_earning re
      INNER JOIN payout_batch pb ON pb.id = re."payoutBatchId"
      WHERE re."payoutBatchId" = ANY($1)
      ORDER BY pb."createdAt" DESC, re."createdAt" DESC
    `, [batchIds]) : [];

    // Helper function to convert UTC to EST
    const convertToEST = (date: Date | string) => {
      const d = new Date(date);
      return d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' });
    };

    // Helper function to sanitize CSV values
    const sanitizeCsvValue = (value: any) => {
      if (!value) return '';
      const str = String(value);
      if (/^[=\-+@]/.test(str)) {
        return `'${str}`;
      }
      return str.replace(/"/g, '""');
    };

    // Generate CSV headers
    const csvHeaders = [
      'Payout Batch ID',
      'Payout Date (EST)',
      'Payout Status',
      'Transaction Signature',
      'Total Amount (SOL)',
      'Total Amount (USD)',
      'Recipient Count',
      'Earning Count',
      '---',
      'Earning ID',
      'Referrer Wallet',
      'Referred Wallet',
      'Match ID',
      'Amount Paid (SOL)',
      'Amount Paid (USD)',
      'Tier Name',
      'Tier Level',
      'Percentage',
      'Both Players Referred',
      'Earning Created At (EST)',
    ];

    // Generate CSV rows
    const csvRows: string[][] = [];
    
    for (const batch of payoutBatches) {
      const batchEarnings = allEarnings.filter((e: any) => e.payoutBatchId === batch.id);
      
      if (batchEarnings.length === 0) {
        // Batch with no earnings
        csvRows.push([
          sanitizeCsvValue(batch.id),
          convertToEST(batch.createdAt),
          sanitizeCsvValue(batch.status),
          sanitizeCsvValue(batch.transactionSignature || ''),
          sanitizeCsvValue(batch.totalAmountSOL || '0'),
          sanitizeCsvValue(batch.totalAmountUSD || '0'),
          sanitizeCsvValue(batch.recipientCount || '0'),
          sanitizeCsvValue(batch.earningCount || '0'),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
      } else {
        // Add a row for each earning in the batch
        batchEarnings.forEach((earning: any, index: number) => {
          csvRows.push([
            // Batch info (same for all earnings in batch)
            index === 0 ? sanitizeCsvValue(batch.id) : '',
            index === 0 ? convertToEST(batch.createdAt) : '',
            index === 0 ? sanitizeCsvValue(batch.status) : '',
            index === 0 ? sanitizeCsvValue(batch.transactionSignature || '') : '',
            index === 0 ? sanitizeCsvValue(batch.totalAmountSOL || '0') : '',
            index === 0 ? sanitizeCsvValue(batch.totalAmountUSD || '0') : '',
            index === 0 ? sanitizeCsvValue(batch.recipientCount || '0') : '',
            index === 0 ? sanitizeCsvValue(batch.earningCount || '0') : '',
            index === 0 ? '---' : '',
            // Earning details
            sanitizeCsvValue(earning.id),
            sanitizeCsvValue(earning.uplineWallet),
            sanitizeCsvValue(earning.downlineWallet),
            sanitizeCsvValue(earning.matchId),
            sanitizeCsvValue(earning.amountSOL || '0'),
            sanitizeCsvValue(earning.amountUSD || '0'),
            sanitizeCsvValue(earning.tierName || ''),
            sanitizeCsvValue(earning.tier || ''),
            sanitizeCsvValue(earning.percentage || '0'),
            sanitizeCsvValue(earning.bothPlayersReferred ? 'Yes' : 'No'),
            convertToEST(earning.createdAt),
          ]);
        });
      }
    }

    // Generate CSV content
    const csvContent = [csvHeaders, ...csvRows]
      .map((row: any) => row.map((field: any) => `"${field || ''}"`).join(','))
      .join('\n');
    
    // Generate file hash for integrity
    const crypto = require('crypto');
    const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');
    
    // Set response headers for CSV download
    const filename = `referral-payout-history-${startDate}-to-${endDate}.csv`;
    
    (res as any).setHeader('Content-Type', 'text/csv');
    (res as any).setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    (res as any).setHeader('X-File-Hash', fileHash);
    
    console.log(`✅ Referral payout history CSV generated: ${filename} with ${payoutBatches.length} batches`);
    console.log(`🔐 File integrity hash: ${fileHash}`);
    
    res.send(csvContent);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error generating referral payout history CSV:', errorMessage);
    return res.status(500).json({ error: 'Failed to generate CSV', details: errorMessage });
  }
};


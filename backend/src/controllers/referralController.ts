import { Request, Response } from 'express';
import { ReferralService } from '../services/referralService';
import { UserService } from '../services/userService';
import { AntiAbuseService } from '../services/antiAbuseService';
import { AppDataSource } from '../db';
import { ReferralEarning } from '../models/ReferralEarning';

/**
 * Create referral link / process referral
 * POST /api/referral/link
 */
export const createReferralLink = async (req: Request, res: Response) => {
  try {
    const { referredWallet, referrerWallet } = req.body;

    if (!referredWallet || !referrerWallet) {
      return res.status(400).json({ error: 'referredWallet and referrerWallet are required' });
    }

    // Check for self-referral
    if (AntiAbuseService.detectSelfReferral(referredWallet, referrerWallet)) {
      return res.status(400).json({ error: 'Cannot refer yourself' });
    }

    const referral = await ReferralService.processReferral(referredWallet, referrerWallet);

    return res.json({
      success: true,
      referral: {
        id: referral.id,
        referredWallet: referral.referredWallet,
        referrerWallet: referral.referrerWallet,
        eligible: referral.eligible
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error creating referral link:', errorMessage);
    return res.status(500).json({ error: 'Failed to create referral link', details: errorMessage });
  }
};

/**
 * Get referral dashboard data
 * GET /api/referral/dashboard?wallet=...
 */
export const getReferralDashboard = async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'wallet query parameter is required' });
    }

    const stats = await ReferralService.getReferralStats(wallet);
    const breakdown = await ReferralService.getEarningsBreakdown(wallet);
    const isEligible = await UserService.checkReferralEligibility(wallet);
    const canReferCheck = await UserService.canReferOthers(wallet);

    // Calculate next payout date (Sunday 13:00 EST)
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay())); // Next Sunday
    nextSunday.setHours(13, 0, 0, 0); // 1:00 PM EST

    return res.json({
      success: true,
      stats,
      breakdown,
      isEligible,
      canReferOthers: canReferCheck.canRefer,
      canReferReason: canReferCheck.reason,
      matchCount: canReferCheck.matchCount,
      exemptFromMinimum: canReferCheck.exempt,
      nextPayoutDate: nextSunday.toISOString()
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting referral dashboard:', errorMessage);
    return res.status(500).json({ error: 'Failed to get referral dashboard', details: errorMessage });
  }
};

/**
 * Get referral statistics
 * GET /api/referral/stats?wallet=...
 */
export const getReferralStats = async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'wallet query parameter is required' });
    }

    const stats = await ReferralService.getReferralStats(wallet);
    const isEligible = await UserService.checkReferralEligibility(wallet);

    return res.json({
      success: true,
      stats,
      isEligible
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting referral stats:', errorMessage);
    return res.status(500).json({ error: 'Failed to get referral stats', details: errorMessage });
  }
};

/**
 * Download referral payouts as CSV
 * GET /api/referral/payouts/csv?wallet=...
 */
export const downloadReferralPayoutsCSV = async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'wallet query parameter is required' });
    }

    // Get all paid referral earnings for this wallet
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const paidEarnings = await earningRepository.find({
      where: { uplineWallet: wallet, paid: true },
      relations: ['payoutBatch', 'match'],
      order: { paidAt: 'DESC' }
    });

    // Helper to sanitize CSV values
    const sanitizeCsvValue = (value: any) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Helper to format date
    const formatDate = (date: Date | string | null | undefined) => {
      if (!date) return '';
      return new Date(date).toISOString();
    };

    // CSV headers
    const csvHeaders = [
      'Paid Date',
      'Match ID',
      'Referred Wallet',
      'Level',
      'Amount USD',
      'Amount SOL',
      'Transaction Signature',
      'Payout Batch ID',
      'Match Entry Fee',
      'Match Status'
    ];

    // CSV rows
    const csvRows = paidEarnings.map(earning => [
      sanitizeCsvValue(formatDate(earning.paidAt)),
      sanitizeCsvValue(earning.matchId),
      sanitizeCsvValue(earning.referredWallet),
      sanitizeCsvValue(earning.level),
      sanitizeCsvValue(earning.amountUSD),
      sanitizeCsvValue(earning.amountSOL || ''),
      sanitizeCsvValue(earning.payoutBatch?.transactionSignature || ''),
      sanitizeCsvValue(earning.payoutBatchId || ''),
      sanitizeCsvValue(earning.match?.entryFee || ''),
      sanitizeCsvValue(earning.match?.status || '')
    ]);

    // Combine headers and rows
    const csvContent = [csvHeaders, ...csvRows]
      .map((row: any[]) => row.map((field: any) => sanitizeCsvValue(field)).join(','))
      .join('\n');

    // Set response headers for CSV download
    const filename = `Guess5_Referral_Payouts_${wallet.slice(0, 8)}.csv`;
    (res as any).setHeader('Content-Type', 'text/csv');
    (res as any).setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    console.log(`✅ Generated referral payouts CSV for wallet ${wallet.slice(0, 8)}... (${paidEarnings.length} records)`);
    res.send(csvContent);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error generating referral payouts CSV:', errorMessage);
    return res.status(500).json({ error: 'Failed to generate CSV', details: errorMessage });
  }
};


import { Request, Response } from 'express';
import { ReferralService } from '../services/referralService';
import { UserService } from '../services/userService';
import { AntiAbuseService } from '../services/antiAbuseService';

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

    // Get payout history
    const { AppDataSource } = require('../db');
    const { PayoutBatch } = require('../models/PayoutBatch');
    const { ReferralEarning } = require('../models/ReferralEarning');
    
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const paidBatches = await batchRepository.find({
      where: { status: 'sent' },
      order: { createdAt: 'DESC' },
      take: 10
    });

    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const paidEarnings = await earningRepository.find({
      where: { uplineWallet: wallet, paid: true },
      relations: ['payoutBatch'],
      order: { paidAt: 'DESC' },
      take: 20
    });

    return res.json({
      success: true,
      stats,
      breakdown,
      isEligible,
      canReferOthers: canReferCheck.canRefer,
      canReferReason: canReferCheck.reason,
      matchCount: canReferCheck.matchCount,
      exemptFromMinimum: canReferCheck.exempt,
      nextPayoutDate: nextSunday.toISOString(),
      payoutHistory: paidEarnings.map(e => ({
        date: e.paidAt,
        amountUSD: e.amountUSD,
        amountSOL: e.amountSOL,
        level: e.level,
        transactionSignature: e.payoutBatch?.transactionSignature
      }))
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


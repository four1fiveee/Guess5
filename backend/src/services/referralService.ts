import { AppDataSource } from '../db';
import { Referral } from '../models/Referral';
import { ReferralUpline } from '../models/ReferralUpline';
import { ReferralEarning } from '../models/ReferralEarning';
import { Match } from '../models/Match';
import { UserService } from './userService';

/**
 * Referral service for managing referral relationships and earnings
 */
export class ReferralService {
  /**
   * Create a referral relationship
   * @param referredWallet Wallet address of the new user
   * @param referrerWallet Wallet address of the referrer
   */
  static async processReferral(
    referredWallet: string,
    referrerWallet: string
  ): Promise<Referral> {
    // Prevent self-referral
    if (referredWallet.toLowerCase() === referrerWallet.toLowerCase()) {
      throw new Error('Cannot refer yourself');
    }

    const referralRepository = AppDataSource.getRepository(Referral);

    // Check if referral already exists
    const existing = await referralRepository.findOne({
      where: { referredWallet }
    });

    if (existing) {
      return existing; // Already referred
    }

    // Check if referrer can refer others (20 games minimum OR exempt)
    const canReferCheck = await UserService.canReferOthers(referrerWallet);
    if (!canReferCheck.canRefer) {
      throw new Error(canReferCheck.reason || 'Cannot refer others');
    }

    // Check if referrer is eligible for payouts (has played at least one match)
    const isEligible = await UserService.checkReferralEligibility(referrerWallet);

    // Create referral
    const referral = referralRepository.create({
      referredWallet,
      referrerWallet,
      eligible: isEligible,
      active: true
    });

    const savedReferral = await referralRepository.save(referral);

    // Rebuild upline mapping
    await this.buildUplineMapping();

    return savedReferral;
  }

  /**
   * Get referrer chain for a wallet (up to maxDepth levels)
   */
  static async getReferrerChain(
    wallet: string,
    maxDepth: number = 3
  ): Promise<Array<{ wallet: string; level: number }>> {
    const chain: Array<{ wallet: string; level: number }> = [];
    let currentWallet = wallet;
    let level = 1;

    while (level <= maxDepth) {
      const referralRepository = AppDataSource.getRepository(Referral);
      const referral = await referralRepository.findOne({
        where: { referredWallet: currentWallet }
      });

      if (!referral || !referral.referrerWallet) {
        break; // No more referrers
      }

      chain.push({
        wallet: referral.referrerWallet,
        level
      });

      currentWallet = referral.referrerWallet;
      level++;
    }

    return chain;
  }

  /**
   * Build upline mapping using recursive CTE
   * Populates referral_uplines table with all referral chains up to depth 3
   */
  static async buildUplineMapping(): Promise<void> {
    const uplineRepository = AppDataSource.getRepository(ReferralUpline);

    // Clear existing uplines
    await uplineRepository.clear();

    // Use recursive CTE to build upline chain
    await AppDataSource.query(`
      WITH RECURSIVE chain AS (
        SELECT 
          referred_wallet,
          referrer_wallet,
          1 as level
        FROM referral
        WHERE referrer_wallet IS NOT NULL
          AND active = true
        
        UNION ALL
        
        SELECT 
          r.referred_wallet,
          ref.referrer_wallet,
          c.level + 1
        FROM chain c
        JOIN referral ref ON ref.referred_wallet = c.referrer_wallet
        JOIN referral r ON r.referred_wallet = c.referred_wallet
        WHERE c.level < 3 
          AND ref.referrer_wallet IS NOT NULL
          AND ref.active = true
      )
      INSERT INTO referral_upline (referred_wallet, level, upline_wallet, "createdAt")
      SELECT DISTINCT 
        referred_wallet,
        level,
        referrer_wallet,
        now()
      FROM chain
      WHERE referrer_wallet IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }

  /**
   * Get referrer tier based on active referred wallets count
   * Tiers:
   * - Base: 10% (0-99 active wallets)
   * - Silver: 15% (100-499 active wallets)
   * - Gold: 20% (500-999 active wallets)
   * - Platinum: 25% (1000+ active wallets)
   */
  static async getReferrerTier(referrerWallet: string): Promise<{
    tier: number;
    tierName: string;
    percentage: number;
    activeReferredCount: number;
  }> {
    const referralRepository = AppDataSource.getRepository(Referral);
    
    // Get all referred wallets
    const referred = await referralRepository.find({
      where: { referrerWallet, active: true }
    });
    
    const referredWallets = referred.map(r => r.referredWallet);
    
    // Get active referred count (have played at least one match)
    // A wallet is "active" if they've played at least one completed match
    let activeCount = 0;
    
    if (referredWallets.length > 0) {
      const activeReferred = await AppDataSource.query(`
        SELECT COUNT(DISTINCT wallet) as count
        FROM (
          SELECT "player1" as wallet FROM "match" 
          WHERE "player1" = ANY($1::text[])
          AND status = 'completed'
          UNION
          SELECT "player2" as wallet FROM "match" 
          WHERE "player2" = ANY($1::text[])
          AND status = 'completed'
        ) t
      `, [referredWallets]);
      
      activeCount = parseInt(activeReferred[0]?.count || '0');
    }
    
    // Determine tier based on active count (default to Base if 0)
    let tier = 0;
    let tierName = 'Base';
    let percentage = 0.10; // Base: 10%
    
    if (activeCount >= 1000) {
      tier = 3;
      tierName = 'Platinum';
      percentage = 0.25; // Platinum: 25%
    } else if (activeCount >= 500) {
      tier = 2;
      tierName = 'Gold';
      percentage = 0.20; // Gold: 20%
    } else if (activeCount >= 100) {
      tier = 1;
      tierName = 'Silver';
      percentage = 0.15; // Silver: 15%
    }
    // else: Base tier (tier 0, 10%)
    
    return { tier, tierName, percentage, activeReferredCount: activeCount };
  }

  /**
   * Compute referral earnings for a completed match
   * New tiered system: Direct referrals only, percentage based on referrer tier
   * - Base: 10% of net profit per referred wallet
   * - If both players referred by same person: 20% (10% per player)
   * - Tier upgrades based on active referred count (100/500/1000)
   */
  static async computeReferralEarningsForMatch(matchId: string): Promise<void> {
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    // Skip if already computed
    if (match.referralEarningsComputed) {
      return;
    }

    // Ensure netProfit is calculated
    if (match.netProfit === null || match.netProfit === undefined) {
      throw new Error(`Match ${matchId} netProfit not calculated`);
    }

    const netProfit = Number(match.netProfit);
    if (netProfit <= 0) {
      // No profit, no referral earnings
      match.referralEarningsComputed = true;
      await matchRepository.save(match);
      return;
    }

    const referralRepository = AppDataSource.getRepository(Referral);
    const earningRepository = AppDataSource.getRepository(ReferralEarning);

    // Get direct referrers for each player
    const player1Referral = await referralRepository.findOne({
      where: { referredWallet: match.player1, active: true }
    });
    
    const player2Referral = await referralRepository.findOne({
      where: { referredWallet: match.player2, active: true }
    });

    // Track referrers and their earnings
    const referrerEarnings = new Map<string, { amountUSD: number; playersReferred: string[] }>();

    // Process Player 1's referrer
    if (player1Referral && player1Referral.referrerWallet) {
      const referrerWallet = player1Referral.referrerWallet;
      const tierInfo = await this.getReferrerTier(referrerWallet);
      
      // Calculate earnings: percentage of net profit
      const earningsAmount = netProfit * tierInfo.percentage;
      
      const existing = referrerEarnings.get(referrerWallet) || { amountUSD: 0, playersReferred: [] };
      existing.amountUSD += earningsAmount;
      existing.playersReferred.push(match.player1);
      referrerEarnings.set(referrerWallet, existing);
    }

    // Process Player 2's referrer
    if (player2Referral && player2Referral.referrerWallet) {
      const referrerWallet = player2Referral.referrerWallet;
      const tierInfo = await this.getReferrerTier(referrerWallet);
      
      // Calculate earnings: percentage of net profit
      const earningsAmount = netProfit * tierInfo.percentage;
      
      const existing = referrerEarnings.get(referrerWallet) || { amountUSD: 0, playersReferred: [] };
      existing.amountUSD += earningsAmount;
      existing.playersReferred.push(match.player2);
      referrerEarnings.set(referrerWallet, existing);
    }

    // Create earning records for each referrer
    for (const [referrerWallet, earnings] of referrerEarnings.entries()) {
      // Create one earning record per referrer (not per player)
      // If both players were referred by same person, they get double percentage
      const earning = earningRepository.create({
        matchId: match.id,
        referredWallet: earnings.playersReferred.join(','), // Store both if applicable
        uplineWallet: referrerWallet,
        level: 1, // Always level 1 for direct referrals
        amountUSD: earnings.amountUSD,
        paid: false
      });

      await earningRepository.save(earning);
    }

    // Mark match as computed
    match.referralEarningsComputed = true;
    await matchRepository.save(match);
  }

  /**
   * Get referral statistics for a wallet
   */
  static async getReferralStats(wallet: string): Promise<{
    totalEarnedUSD: number;
    totalEarnedSOL: number;
    pendingUSD: number;
    paidUSD: number;
    referredCount: number;
    activeReferredCount: number;
    eligibleReferredCount: number;
    // Time-based earnings
    earningsAllTime: number;
    earningsYTD: number;
    earningsQTD: number;
    earningsLast7Days: number;
  }> {
    const referralRepository = AppDataSource.getRepository(Referral);
    const earningRepository = AppDataSource.getRepository(ReferralEarning);

    // Get referred wallets count
    const referred = await referralRepository.find({
      where: { referrerWallet: wallet, active: true }
    });

    const referredWallets = referred.map(r => r.referredWallet);

    // Get active referred count (have played at least one match)
    const activeReferred = await AppDataSource.query(`
      SELECT COUNT(DISTINCT wallet) as count
      FROM (
        SELECT "player1" as wallet FROM "match" 
        WHERE "player1" = ANY($1::text[])
        AND status = 'completed'
        UNION
        SELECT "player2" as wallet FROM "match" 
        WHERE "player2" = ANY($1::text[])
        AND status = 'completed'
      ) t
    `, [referredWallets]);

    // Get eligible referred count (have played at least one match)
    const eligibleReferred = await Promise.all(
      referredWallets.map(w => UserService.checkReferralEligibility(w))
    );
    const eligibleCount = eligibleReferred.filter(Boolean).length;

    // Get all earnings
    const earnings = await earningRepository.find({
      where: { uplineWallet: wallet }
    });

    // Calculate time-based earnings
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const earningsAllTime = earnings.reduce((sum, e) => sum + Number(e.amountUSD), 0);
    const earningsYTD = earnings
      .filter(e => new Date(e.createdAt) >= startOfYear)
      .reduce((sum, e) => sum + Number(e.amountUSD), 0);
    const earningsQTD = earnings
      .filter(e => new Date(e.createdAt) >= startOfQuarter)
      .reduce((sum, e) => sum + Number(e.amountUSD), 0);
    const earningsLast7Days = earnings
      .filter(e => new Date(e.createdAt) >= sevenDaysAgo)
      .reduce((sum, e) => sum + Number(e.amountUSD), 0);

    const totalEarnedUSD = earningsAllTime;
    const totalEarnedSOL = earnings.reduce((sum, e) => sum + (Number(e.amountSOL) || 0), 0);
    const paidUSD = earnings
      .filter(e => e.paid)
      .reduce((sum, e) => sum + Number(e.amountUSD), 0);
    const pendingUSD = totalEarnedUSD - paidUSD;

    return {
      totalEarnedUSD,
      totalEarnedSOL,
      pendingUSD,
      paidUSD,
      referredCount: referred.length,
      activeReferredCount: parseInt(activeReferred[0]?.count || '0'),
      eligibleReferredCount: eligibleCount,
      earningsAllTime,
      earningsYTD,
      earningsQTD,
      earningsLast7Days
    };
  }

  /**
   * Get earnings breakdown for a wallet
   * Updated for tiered system - no multi-level chains
   */
  static async getEarningsBreakdown(wallet: string): Promise<{
    byTier: Array<{ tier: number; tierName: string; percentage: number; totalUSD: number; count: number }>;
    byReferredWallet: Array<{ referredWallet: string; totalUSD: number; count: number }>;
    recentEarnings: Array<ReferralEarning>;
    currentTier: { tier: number; tierName: string; percentage: number; activeReferredCount: number };
  }> {
    const earningRepository = AppDataSource.getRepository(ReferralEarning);

    const earnings = await earningRepository.find({
      where: { uplineWallet: wallet },
      relations: ['match'],
      order: { createdAt: 'DESC' }
    });

    // Get current tier
    const currentTier = await this.getReferrerTier(wallet);

    // Group by tier (for historical tracking)
    // Since we're only tracking direct referrals now, all are tier-based
    const byTier = [
      { tier: 0, tierName: 'Base', percentage: 0.10 },
      { tier: 1, tierName: 'Silver', percentage: 0.15 },
      { tier: 2, tierName: 'Gold', percentage: 0.20 },
      { tier: 3, tierName: 'Platinum', percentage: 0.25 }
    ].map(tierInfo => {
      // For now, we'll group all earnings together since tier is dynamic
      // In the future, we could track tier at time of earning
      return {
        tier: tierInfo.tier,
        tierName: tierInfo.tierName,
        percentage: tierInfo.percentage,
        totalUSD: 0, // Will be calculated if we track tier per earning
        count: 0
      };
    });

    // Group by referred wallet
    const byReferredMap = new Map<string, { totalUSD: number; count: number }>();
    earnings.forEach(e => {
      // Handle multiple wallets in referredWallet field (comma-separated)
      const wallets = e.referredWallet.split(',').map(w => w.trim());
      wallets.forEach(wallet => {
        const existing = byReferredMap.get(wallet) || { totalUSD: 0, count: 0 };
        // Split amount if multiple wallets
        existing.totalUSD += Number(e.amountUSD) / wallets.length;
        existing.count += 1;
        byReferredMap.set(wallet, existing);
      });
    });

    const byReferredWallet = Array.from(byReferredMap.entries()).map(([wallet, stats]) => ({
      referredWallet: wallet,
      ...stats
    }));

    // Recent earnings (last 20)
    const recentEarnings = earnings.slice(0, 20);

    return {
      byTier,
      byReferredWallet,
      recentEarnings,
      currentTier
    };
  }
}


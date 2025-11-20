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
   * Compute referral earnings for a completed match
   * This is the core earnings calculation with geometric decay
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

    // Calculate referral pool: 25% of net profit
    const referralPool = netProfit * 0.25;

    // Per-player share: referral pool divided by 2 (since 2 players contribute equally)
    const perPlayerShare = referralPool / 2.0;

    const earningRepository = AppDataSource.getRepository(ReferralEarning);

    // Process each player
    const players = [match.player1, match.player2].filter(Boolean);

    for (const playerWallet of players) {
      // Get upline chain (up to level 3)
      const uplines = await this.getReferrerChain(playerWallet, 3);

      if (uplines.length === 0) {
        continue; // No referrer chain
      }

      // Calculate earnings with geometric decay
      // L1 = perPlayerShare * 1.00
      // L2 = L1 * 0.25
      // L3 = L2 * 0.25
      let levelAmount = perPlayerShare;

      for (const upline of uplines) {
        // Check if upline is eligible
        const isEligible = await UserService.checkReferralEligibility(upline.wallet);
        if (!isEligible) {
          // Still create earning record but mark as pending eligibility
          // The amount will be paid once referrer becomes eligible
        }

        // Create earning record
        const earning = earningRepository.create({
          matchId: match.id,
          referredWallet: playerWallet,
          uplineWallet: upline.wallet,
          level: upline.level,
          amountUSD: levelAmount,
          paid: false
        });

        await earningRepository.save(earning);

        // Apply geometric decay for next level
        levelAmount = levelAmount * 0.25;
      }
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
        SELECT "player1" as wallet FROM "match" WHERE "player1" = ANY($1) AND status = 'completed'
        UNION
        SELECT "player2" as wallet FROM "match" WHERE "player2" = ANY($1) AND status = 'completed'
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
   */
  static async getEarningsBreakdown(wallet: string): Promise<{
    byLevel: Array<{ level: number; totalUSD: number; count: number }>;
    byReferredWallet: Array<{ referredWallet: string; totalUSD: number; count: number }>;
    recentEarnings: Array<ReferralEarning>;
  }> {
    const earningRepository = AppDataSource.getRepository(ReferralEarning);

    const earnings = await earningRepository.find({
      where: { uplineWallet: wallet },
      relations: ['match'],
      order: { createdAt: 'DESC' }
    });

    // Group by level
    const byLevel = [1, 2, 3].map(level => {
      const levelEarnings = earnings.filter(e => e.level === level);
      return {
        level,
        totalUSD: levelEarnings.reduce((sum, e) => sum + Number(e.amountUSD), 0),
        count: levelEarnings.length
      };
    });

    // Group by referred wallet
    const byReferredMap = new Map<string, { totalUSD: number; count: number }>();
    earnings.forEach(e => {
      const existing = byReferredMap.get(e.referredWallet) || { totalUSD: 0, count: 0 };
      existing.totalUSD += Number(e.amountUSD);
      existing.count += 1;
      byReferredMap.set(e.referredWallet, existing);
    });

    const byReferredWallet = Array.from(byReferredMap.entries()).map(([wallet, stats]) => ({
      referredWallet: wallet,
      ...stats
    }));

    // Recent earnings (last 20)
    const recentEarnings = earnings.slice(0, 20);

    return {
      byLevel,
      byReferredWallet,
      recentEarnings
    };
  }
}


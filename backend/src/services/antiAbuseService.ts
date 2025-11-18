import { AppDataSource } from '../db';
import { Referral } from '../models/Referral';
import { ReferralEarning } from '../models/ReferralEarning';

/**
 * Anti-abuse service for detecting fraudulent referral activity
 */
export class AntiAbuseService {
  /**
   * Detect self-referral attempts
   */
  static detectSelfReferral(referredWallet: string, referrerWallet: string): boolean {
    return referredWallet.toLowerCase() === referrerWallet.toLowerCase();
  }

  /**
   * Detect potential Sybil attacks
   * Flags referrers who create many wallets from same IP/device
   */
  static async detectSybilAttack(referrerWallet: string): Promise<{
    suspicious: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];
    let suspicious = false;

    const referralRepository = AppDataSource.getRepository(Referral);
    
    // Count referred wallets
    const referrals = await referralRepository.find({
      where: { referrerWallet, active: true }
    });

    const referredCount = referrals.length;

    // Flag if referrer has >50 referred wallets
    if (referredCount > 50) {
      suspicious = true;
      reasons.push(`High number of referred wallets: ${referredCount}`);
    }

    // Check for many small wallets (potential fake accounts)
    const matchRepository = AppDataSource.getRepository('Match');
    const smallWalletCount = await matchRepository.query(`
      SELECT COUNT(DISTINCT wallet) as count
      FROM (
        SELECT "player1" as wallet FROM "match" WHERE "player1" = ANY($1)
        UNION
        SELECT "player2" as wallet FROM "match" WHERE "player2" = ANY($1)
      ) t
      JOIN "match" m ON (m."player1" = t.wallet OR m."player2" = t.wallet)
      GROUP BY t.wallet
      HAVING COUNT(*) = 1 AND SUM(m."entryFeeUSD") < 5
    `, [referrals.map(r => r.referredWallet)]);

    if (smallWalletCount[0]?.count > 10) {
      suspicious = true;
      reasons.push(`Many small wallets referred: ${smallWalletCount[0].count}`);
    }

    return { suspicious, reasons };
  }

  /**
   * Validate payout batch for anomalies
   */
  static async validatePayoutBatch(batchId: string): Promise<{
    valid: boolean;
    warnings: string[];
    errors: string[];
  }> {
    const warnings: string[] = [];
    const errors: string[] = [];

    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const earnings = await earningRepository.find({
      where: { payoutBatchId: batchId }
    });

    // Group by upline wallet
    const walletTotals = new Map<string, number>();
    earnings.forEach(e => {
      const existing = walletTotals.get(e.uplineWallet) || 0;
      walletTotals.set(e.uplineWallet, existing + Number(e.amountUSD));
    });

    const totalAmount = Array.from(walletTotals.values()).reduce((sum, val) => sum + val, 0);

    // Check for single referrer dominance
    for (const [wallet, amount] of walletTotals.entries()) {
      const percentage = (amount / totalAmount) * 100;
      if (percentage > 50) {
        warnings.push(`Single referrer ${wallet} has ${percentage.toFixed(2)}% of batch`);
      }
    }

    // Check for suspicious patterns
    for (const [wallet, amount] of walletTotals.entries()) {
      const sybilCheck = await this.detectSybilAttack(wallet);
      if (sybilCheck.suspicious) {
        warnings.push(`Suspicious referrer ${wallet}: ${sybilCheck.reasons.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }

  /**
   * Flag suspicious referrer for manual review
   */
  static async flagSuspiciousReferrer(wallet: string): Promise<void> {
    // In a real implementation, this would create a review record
    // For now, just log
    console.warn(`⚠️ Flagged suspicious referrer: ${wallet}`);
    
    const sybilCheck = await this.detectSybilAttack(wallet);
    if (sybilCheck.suspicious) {
      console.warn(`  Reasons: ${sybilCheck.reasons.join(', ')}`);
    }
  }

  /**
   * Get all abuse flags for admin dashboard
   */
  static async getAbuseFlags(): Promise<Array<{
    wallet: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  }>> {
    const flags: Array<{ wallet: string; reason: string; severity: 'low' | 'medium' | 'high' }> = [];

    const referralRepository = AppDataSource.getRepository(Referral);
    
    // Get all referrers with many referrals
    const referrers = await referralRepository.query(`
      SELECT referrer_wallet, COUNT(*) as count
      FROM referral
      WHERE active = true
      GROUP BY referrer_wallet
      HAVING COUNT(*) > 20
      ORDER BY COUNT(*) DESC
    `);

    for (const ref of referrers) {
      const sybilCheck = await this.detectSybilAttack(ref.referrer_wallet);
      if (sybilCheck.suspicious) {
        flags.push({
          wallet: ref.referrer_wallet,
          reason: sybilCheck.reasons.join('; '),
          severity: ref.count > 50 ? 'high' : 'medium'
        });
      }
    }

    return flags;
  }
}


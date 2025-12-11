import { query } from '../datasources/postgres';
import { entryFeeStatsSql } from '../sql/queries';
import { FinanceSummary, TimeWindow, FinanceTierBreakdown } from '@guess5-dashboard/shared';
import { getSOLPrice } from '../datasources/pricing';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

const TIER_NAMES: Record<number, string> = {
  0.05: 'Starter',
  0.2: 'Competitive',
  0.5: 'Veteran',
  1.0: 'VIP Elite',
};

export async function getFinanceSummary(force: boolean = false): Promise<FinanceSummary> {
  // Get SOL price
  const solPrice = await getSOLPrice();

  // Vault fee balance (simplified - would need to query actual vault or transaction table)
  // For now, we'll compute from matches where fees were collected
  const vaultBalanceResult = await query<{ total: string }>(`
    SELECT COALESCE(SUM("totalFeesCollected"), 0) AS total
    FROM "match"
    WHERE "totalFeesCollected" IS NOT NULL
  `);
  const vaultBalanceSOL = parseFloat(vaultBalanceResult.rows[0]?.total || '0');
  const vaultBalanceUSD = vaultBalanceSOL * solPrice;

  // Per-tier stats
  const windows: TimeWindow[] = ['24h', '7d', '30d'];
  const tierMap = new Map<number, FinanceTierBreakdown>();

  for (const window of windows) {
    const { sql, params } = entryFeeStatsSql(window);
    const result = await query<{
      entryFee: string;
      grossEntryFees: string;
      platformFees: string;
      bonuses: string;
      netRevenue: string;
    }>(sql, params);

    for (const row of result.rows) {
      const entryFee = parseFloat(row.entryFee);
      const tierName = TIER_NAMES[entryFee] || `$${entryFee}`;

      if (!tierMap.has(entryFee)) {
        tierMap.set(entryFee, {
          tier: tierName,
          entryFee,
          grossEntryFees: { '24h': 0, '7d': 0, '30d': 0 },
          platformFees: { '24h': 0, '7d': 0, '30d': 0 },
          bonuses: { '24h': 0, '7d': 0, '30d': 0 },
          netRevenue: { '24h': 0, '7d': 0, '30d': 0 },
        });
      }

      const tier = tierMap.get(entryFee)!;
      tier.grossEntryFees[window] = parseFloat(row.grossEntryFees || '0');
      tier.platformFees[window] = parseFloat(row.platformFees || '0');
      tier.bonuses[window] = parseFloat(row.bonuses || '0');
      tier.netRevenue[window] = parseFloat(row.netRevenue || '0');
    }
  }

  // Calculate totals
  const totals = {
    grossEntryFees: { '24h': 0, '7d': 0, '30d': 0 },
    platformFees: { '24h': 0, '7d': 0, '30d': 0 },
    bonuses: { '24h': 0, '7d': 0, '30d': 0 },
    netRevenue: { '24h': 0, '7d': 0, '30d': 0 },
  };

  for (const tier of tierMap.values()) {
    for (const window of windows) {
      totals.grossEntryFees[window] += tier.grossEntryFees[window];
      totals.platformFees[window] += tier.platformFees[window];
      totals.bonuses[window] += tier.bonuses[window];
      totals.netRevenue[window] += tier.netRevenue[window];
    }
  }

  return {
    vaultFeeBalance: {
      sol: vaultBalanceSOL,
      usd: vaultBalanceUSD,
    },
    byTier: Array.from(tierMap.values()),
    totals,
  };
}








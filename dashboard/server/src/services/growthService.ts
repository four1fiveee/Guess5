import { query } from '../datasources/postgres';
import { uniqueWalletsSql, newWalletsSql, matchesPerUserSql } from '../sql/queries';
import { GrowthSummary, TimeWindow } from '@guess5-dashboard/shared';

export async function getGrowthSummary(force: boolean = false): Promise<GrowthSummary> {
  const windows: TimeWindow[] = ['24h', '7d', '30d'];

  const uniqueWallets: Record<TimeWindow, number> = {
    '24h': 0,
    '7d': 0,
    '30d': 0,
  };

  const matchesPerUser: Record<TimeWindow, number> = {
    '24h': 0,
    '7d': 0,
    '30d': 0,
  };

  for (const window of windows) {
    // Unique wallets
    const { sql: uniqueSql, params: uniqueParams } = uniqueWalletsSql(window);
    const uniqueResult = await query<{ count: string }>(uniqueSql, uniqueParams);
    uniqueWallets[window] = parseInt(uniqueResult.rows[0]?.count || '0', 10);

    // Matches per user
    const { sql: mpuSql, params: mpuParams } = matchesPerUserSql(window);
    const mpuResult = await query<{ matchesPerUser: string }>(mpuSql, mpuParams);
    matchesPerUser[window] = parseFloat(mpuResult.rows[0]?.matchesPerUser || '0');
  }

  // New wallets in last 24h
  const { sql: newSql, params: newParams } = newWalletsSql('24h');
  const newResult = await query<{ count: string }>(newSql, newParams);
  const newWallets24h = parseInt(newResult.rows[0]?.count || '0', 10);

  return {
    uniqueWallets,
    newWallets24h,
    matchesPerUser,
  };
}








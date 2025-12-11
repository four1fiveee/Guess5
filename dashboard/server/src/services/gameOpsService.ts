import { query } from '../datasources/postgres';
import {
  recentMatchesSql,
  outcomeBreakdownSql,
  averagePayoutSql,
  averageMatchmakingSql,
  activeWalletsSql,
  activeGamesSql,
} from '../sql/queries';
import { GameOpsSummary, TimeWindow, RecentMatch, OutcomeBreakdown } from '@guess5-dashboard/shared';

export async function getGameOpsSummary(force: boolean = false): Promise<GameOpsSummary> {
  // Active wallets
  const activeWalletsResult = await query<{ count: string }>(activeWalletsSql());
  const activeWallets = parseInt(activeWalletsResult.rows[0]?.count || '0', 10);

  // Active games
  const activeGamesResult = await query<{ count: string }>(activeGamesSql());
  const activeGames = parseInt(activeGamesResult.rows[0]?.count || '0', 10);

  // Recent matches
  const recentMatchesResult = await query<RecentMatch>(recentMatchesSql(10), [10]);
  const recentMatches = recentMatchesResult.rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    gameEndTime: row.gameEndTime ? new Date(row.gameEndTime) : undefined,
    proposalExecutedAt: row.proposalExecutedAt ? new Date(row.proposalExecutedAt) : undefined,
  }));

  // Average payout time
  const windows: TimeWindow[] = ['24h', '7d', '30d'];
  const averagePayoutTime: Record<TimeWindow, number | null> = {
    '24h': null,
    '7d': null,
    '30d': null,
  };

  for (const window of windows) {
    const { sql, params } = averagePayoutSql(window);
    const result = await query<{ avgPayoutTime: string | null }>(sql, params);
    const avg = result.rows[0]?.avgPayoutTime;
    averagePayoutTime[window] = avg ? parseFloat(avg) : null;
  }

  // Average matchmaking time
  const averageMatchmakingTime: Record<TimeWindow, number | null> = {
    '24h': null,
    '7d': null,
    '30d': null,
  };

  for (const window of windows) {
    const { sql, params } = averageMatchmakingSql(window);
    const result = await query<{ avgMatchmakingTime: string | null }>(sql, params);
    const avg = result.rows[0]?.avgMatchmakingTime;
    averageMatchmakingTime[window] = avg ? parseFloat(avg) : null;
  }

  // Outcome breakdown
  const outcomePercentages: Record<TimeWindow, OutcomeBreakdown> = {
    '24h': { decisive: 0, winningTie: 0, losingTie: 0, refundOrError: 0, total: 0 },
    '7d': { decisive: 0, winningTie: 0, losingTie: 0, refundOrError: 0, total: 0 },
    '30d': { decisive: 0, winningTie: 0, losingTie: 0, refundOrError: 0, total: 0 },
  };

  for (const window of windows) {
    const { sql, params } = outcomeBreakdownSql(window);
    const result = await query<{
      decisive: string;
      winningTie: string;
      losingTie: string;
      refundOrError: string;
      total: string;
    }>(sql, params);
    const row = result.rows[0];
    if (row) {
      outcomePercentages[window] = {
        decisive: parseInt(row.decisive || '0', 10),
        winningTie: parseInt(row.winningTie || '0', 10),
        losingTie: parseInt(row.losingTie || '0', 10),
        refundOrError: parseInt(row.refundOrError || '0', 10),
        total: parseInt(row.total || '0', 10),
      };
    }
  }

  return {
    activeWallets,
    activeGames,
    averagePayoutTime,
    averageMatchmakingTime,
    recentMatches,
    outcomePercentages,
  };
}








import { TimeWindow } from '@guess5-dashboard/shared';
import { buildWindowClause } from './windows';

export function recentMatchesSql(limit: number = 10): string {
  return `
    SELECT 
      id,
      "player1",
      "player2",
      "entryFee",
      status,
      "matchOutcome",
      winner,
      "createdAt",
      "updatedAt",
      "gameEndTime",
      "proposalExecutedAt"
    FROM "match"
    ORDER BY "updatedAt" DESC
    LIMIT $1
  `;
}

export function outcomeBreakdownSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT
        COUNT(*) FILTER (WHERE winner IS NOT NULL AND winner != 'tie' AND winner != 'cancelled') AS decisive,
        COUNT(*) FILTER (WHERE winner = 'tie' AND "matchOutcome" = 'WINNING_TIE') AS "winningTie",
        COUNT(*) FILTER (WHERE winner = 'tie' AND "matchOutcome" = 'LOSING_TIE') AS "losingTie",
        COUNT(*) FILTER (WHERE "matchOutcome" IN ('REFUND', 'ERROR') OR status IN ('cancelled', 'refund_pending')) AS "refundOrError",
        COUNT(*) AS total
      FROM "match"
      WHERE "createdAt" >= ${clause}
    `,
    params: [],
  };
}

export function averagePayoutSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT
        AVG(EXTRACT(EPOCH FROM ("proposalExecutedAt" - "gameEndTime"))) AS "avgPayoutTime"
      FROM "match"
      WHERE "gameEndTime" IS NOT NULL
        AND "proposalExecutedAt" IS NOT NULL
        AND "createdAt" >= ${clause}
    `,
    params: [],
  };
}

export function averageMatchmakingSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT
        AVG(EXTRACT(EPOCH FROM (
          COALESCE("player1PaymentTime", "player2PaymentTime", "createdAt") - "createdAt"
        ))) AS "avgMatchmakingTime"
      FROM "match"
      WHERE ("player1PaymentTime" IS NOT NULL OR "player2PaymentTime" IS NOT NULL)
        AND "createdAt" >= ${clause}
    `,
    params: [],
  };
}

export function entryFeeStatsSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT
        "entryFee",
        COUNT(*) * "entryFee" * 2 AS "grossEntryFees",
        COUNT(*) * "entryFee" * 2 * 0.05 AS "platformFees",
        COALESCE(SUM("bonusAmount"), 0) AS bonuses,
        COUNT(*) * "entryFee" * 2 * 0.05 - COALESCE(SUM("bonusAmount"), 0) AS "netRevenue"
      FROM "match"
      WHERE "createdAt" >= ${clause}
      GROUP BY "entryFee"
      ORDER BY "entryFee"
    `,
    params: [],
  };
}

export function uniqueWalletsSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT COUNT(DISTINCT wallet) AS count
      FROM (
        SELECT "player1" AS wallet FROM "match" WHERE "createdAt" >= ${clause}
        UNION
        SELECT "player2" AS wallet FROM "match" WHERE "player2" IS NOT NULL AND "createdAt" >= ${clause}
      ) wallets
    `,
    params: [],
  };
}

export function newWalletsSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT COUNT(*) AS count
      FROM (
        SELECT wallet, MIN("createdAt") AS first_seen
        FROM (
          SELECT "player1" AS wallet, "createdAt" FROM "match"
          UNION ALL
          SELECT "player2" AS wallet, "createdAt" FROM "match" WHERE "player2" IS NOT NULL
        ) all_wallets
        GROUP BY wallet
        HAVING MIN("createdAt") >= ${clause}
      ) new_wallets
    `,
    params: [],
  };
}

export function matchesPerUserSql(window: TimeWindow): { sql: string; params: any[] } {
  const { clause } = buildWindowClause(window);
  return {
    sql: `
      SELECT
        CASE 
          WHEN COUNT(DISTINCT wallet) > 0 
          THEN COUNT(*)::numeric / COUNT(DISTINCT wallet)
          ELSE 0
        END AS "matchesPerUser"
      FROM (
        SELECT "player1" AS wallet FROM "match" WHERE "createdAt" >= ${clause}
        UNION ALL
        SELECT "player2" AS wallet FROM "match" WHERE "player2" IS NOT NULL AND "createdAt" >= ${clause}
      ) wallets
    `,
    params: [],
  };
}

export function activeWalletsSql(): string {
  return `
    SELECT COUNT(DISTINCT wallet) AS count
    FROM (
      SELECT "player1" AS wallet FROM "match" 
      WHERE "updatedAt" >= NOW() - INTERVAL '10 minutes'
      UNION
      SELECT "player2" AS wallet FROM "match" 
      WHERE "player2" IS NOT NULL AND "updatedAt" >= NOW() - INTERVAL '10 minutes'
    ) wallets
  `;
}

export function activeGamesSql(): string {
  return `
    SELECT COUNT(*) AS count
    FROM "match"
    WHERE status = 'active'
  `;
}


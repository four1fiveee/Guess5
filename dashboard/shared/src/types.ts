export type TimeWindow = '24h' | '7d' | '30d';

export interface MetricValue {
  value: number;
  formatted: string;
  unit?: string;
}

export interface WindowedMetric<T> {
  '24h': T;
  '7d': T;
  '30d': T;
}

export interface RecentMatch {
  id: string;
  player1: string;
  player2: string | null;
  entryFee: number;
  status: string;
  matchOutcome?: string;
  winner?: string;
  createdAt: Date;
  updatedAt: Date;
  gameEndTime?: Date;
  proposalExecutedAt?: Date;
}

export interface OutcomeBreakdown {
  decisive: number; // win/loss
  winningTie: number;
  losingTie: number;
  refundOrError: number;
  total: number;
}

export interface GameOpsSummary {
  activeWallets: number;
  activeGames: number;
  averagePayoutTime: WindowedMetric<number | null>; // seconds
  averageMatchmakingTime: WindowedMetric<number | null>; // seconds
  recentMatches: RecentMatch[];
  outcomePercentages: WindowedMetric<OutcomeBreakdown>;
}

export interface FinanceTierBreakdown {
  tier: string;
  entryFee: number;
  grossEntryFees: WindowedMetric<number>;
  platformFees: WindowedMetric<number>;
  bonuses: WindowedMetric<number>;
  netRevenue: WindowedMetric<number>;
}

export interface FinanceSummary {
  vaultFeeBalance: {
    sol: number;
    usd: number;
  };
  byTier: FinanceTierBreakdown[];
  totals: {
    grossEntryFees: WindowedMetric<number>;
    platformFees: WindowedMetric<number>;
    bonuses: WindowedMetric<number>;
    netRevenue: WindowedMetric<number>;
  };
}

export interface GrowthSummary {
  uniqueWallets: WindowedMetric<number>;
  newWallets24h: number;
  matchesPerUser: WindowedMetric<number>;
}

export interface InfraHealth {
  render: {
    status: 'healthy' | 'degraded' | 'down';
    responseTime?: number;
  };
  redis: {
    mm: {
      queueDepth: number;
      status: 'healthy' | 'degraded' | 'down';
    };
    ops: {
      queueDepth: number;
      status: 'healthy' | 'degraded' | 'down';
    };
  };
  postgres: {
    latency: number; // ms
    status: 'healthy' | 'degraded' | 'down';
  };
  solana: {
    latency: number; // ms
    status: 'healthy' | 'degraded' | 'down';
  };
  errorLogs: Array<{
    timestamp: Date;
    matchId?: string;
    message: string;
    severity?: string;
  }>;
}

export interface MatchLookup {
  id: string;
  player1: string;
  player2: string | null;
  status: string;
  entryFee: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeleteMatchResult {
  matchId: string;
  success: boolean;
  error?: string;
}








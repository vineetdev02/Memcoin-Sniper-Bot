import type { FilterId } from "./filter.js";

export interface FilterPerformance {
  filterId: FilterId;
  // Trades opened where this filter passed
  passedTrades: number;
  passedWins: number;
  passedLosses: number;
  passedWinRatePct: number;
  // Pools rejected by this filter (would-be trades dropped)
  rejected: number;
  // Net PnL across closed positions where this filter passed
  netPnlUsd: number;
  avgPnlUsd: number;
  // Predictive lift: passedWinRate - baselineWinRate
  liftPct: number;
}

export interface BucketPerformance {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnlUsd: number;
}

export interface AnalyticsSnapshot {
  totalClosed: number;
  baselineWinRatePct: number;
  netPnlUsd: number;
  profitFactor: number;
  filterPerformance: FilterPerformance[];
  byDex: BucketPerformance[];
  byLiquidity: BucketPerformance[];
  byHour: BucketPerformance[];
  byScoreBucket: BucketPerformance[];
  takenAt: number;
}

export interface BacktestSummary {
  presetName: string;
  poolsReplayed: number;
  snipes: number;
  rejects: number;
  acceptanceRatePct: number;
  totalDurationMs: number;
  filterPassCounts: Record<string, number>;
  filterFailCounts: Record<string, number>;
  takenAt: number;
}

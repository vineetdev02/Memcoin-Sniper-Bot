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

export type StatsWindowKey = "10m" | "30m" | "1h" | "6h" | "24h" | "7d" | "all";

export interface TradeHighlight {
  positionId: string;
  tokenMint: string;
  tokenSymbol: string | null;
  source: string;
  entrySizeUsd: number;
  realizedPnlUsd: number;
  realizedPnlPct: number;
  peakGainPct: number;
  closeReason: string | null;
  closedAt: number;
}

export interface BankrollPoint {
  ts: number;
  balanceUsd: number;
  realizedPnlUsd: number;
  openExposureUsd: number;
}

export interface TradeStatsWindow {
  windowKey: StatsWindowKey;
  windowMs: number;
  fromTs: number;
  toTs: number;
  // Activity counts
  positionsOpenedInWindow: number;
  positionsClosedInWindow: number;
  // Money flow (closed positions in window)
  investedUsd: number;
  realizedPnlUsd: number;
  totalGrossWinUsd: number;
  totalGrossLossUsd: number;
  // Performance
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  roiPct: number;
  // Breakdowns
  byDex: BucketPerformance[];
  byCloseReason: BucketPerformance[];
  // Highlights
  topWinner: TradeHighlight | null;
  topLoser: TradeHighlight | null;
  // Series
  bankrollSeries: BankrollPoint[];
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

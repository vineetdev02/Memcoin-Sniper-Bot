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

/** One filter's record on every shadow-tracked launch, bought or not. */
export interface ShadowFilterRow {
  filterId: FilterId;
  failed: number;
  failedPumped: number;
  passed: number;
  passedPumped: number;
}

/** What happened to every launch after its verdict, from the shadow tracker's files. */
export interface ShadowReport {
  launches: number;
  pumped: number;
  pumpThresholdPct: number;
  horizonMin: number;
  snipes: number;
  snipesPumped: number;
  fromTs: number;
  toTs: number;
  filters: ShadowFilterRow[];
}

/**
 * "holds": the 95% range is above break-even and both halves made money.
 * "loses": the whole range is below break-even. "unclear": the range takes in
 * break-even, so the trades cannot tell the rule from luck. "thin": too few
 * trades to say anything.
 */
export type StrategyVerdict = "holds" | "unclear" | "loses" | "thin";

/** The trades one entry rule would have made on the shadow-tracked launches, with the current exits. */
export interface StrategyCheckRow {
  entrySec: number;
  minCurveSol: number;
  trades: number;
  totalUsd: number;
  perTradeUsd: number;
  // a 95% range for the per-trade figure, from its standard error; null under two trades
  perTradeLowUsd: number | null;
  perTradeHighUsd: number | null;
  winRate: number;
  bestUsd: number;
  worstUsd: number;
  // per trade in the earlier and the later half of the launches, by detection time
  firstHalfPerTradeUsd: number | null;
  secondHalfPerTradeUsd: number | null;
  verdict: StrategyVerdict;
}

/** The current settings replayed on every pump.fun launch the shadow tracker followed. */
export interface StrategyCheck {
  launches: number;
  fromTs: number;
  toTs: number;
  stakeUsd: number;
  solUsd: number;
  // true when Jupiter had no SOL price and a fixed estimate sized the trades
  solUsdEstimated: boolean;
  // the current settings: wait before judging, plus the Demand line when that filter is on
  yours: StrategyCheckRow;
  // the same exits buying every launch at the same moment, Demand line or not
  everyLaunch: StrategyCheckRow;
  // the same Demand line and exits at other entry delays, the current one among them
  byDelay: StrategyCheckRow[];
  // enabled filters that judge things the shadow files cannot replay
  notReplayed: string[];
}

/** One closed trade, for the per-trade charts on the Stats page. */
export interface TradePoint {
  closedAt: number;
  tokenMint: string;
  pnlUsd: number;
  pnlPct: number;
  peakGainPct: number;
  holdSec: number;
  reason: string;
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
  // the paper account's basis, set at the last reset
  startingBalanceUsd: number;
  // Breakdowns
  byDex: BucketPerformance[];
  byCloseReason: BucketPerformance[];
  // Highlights
  topWinner: TradeHighlight | null;
  topLoser: TradeHighlight | null;
  // Series
  bankrollSeries: BankrollPoint[];
  // closed in the window, oldest first, the most recent MAX_TRADE_POINTS
  trades: TradePoint[];
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

/**
 * The daily report's numbers. Pure — the caller decides where the closed
 * trades come from (Postgres normally, this process's memory as a fallback).
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClosedTrade {
  mint: string;
  symbol?: string | null;
  realizedPnlUsd: number;
  entrySizeUsd: number;
  closeReason: string | null;
  closedAt: number;
}

export interface DailySummary {
  fromTs: number;
  toTs: number;
  closed: number;
  wins: number;
  losses: number;
  winRatePct: number;
  realizedPnlUsd: number;
  deployedUsd: number;
  roiPct: number;
  profitFactor: number;
  best: ClosedTrade | null;
  worst: ClosedTrade | null;
  rugs: number;
}

export function summarize(trades: ClosedTrade[], fromTs: number, toTs: number): DailySummary {
  const inWindow = trades.filter((t) => t.closedAt >= fromTs && t.closedAt < toTs);

  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let realized = 0;
  let deployed = 0;
  let rugs = 0;
  let best: ClosedTrade | null = null;
  let worst: ClosedTrade | null = null;

  for (const t of inWindow) {
    realized += t.realizedPnlUsd;
    deployed += t.entrySizeUsd;
    if (t.closeReason === "rug-pull") rugs++;
    // Same rule as PositionStore and the drawdown circuit: break-even is not a win.
    if (t.realizedPnlUsd > 0) {
      wins++;
      grossWin += t.realizedPnlUsd;
      if (!best || t.realizedPnlUsd > best.realizedPnlUsd) best = t;
    } else {
      grossLoss += -t.realizedPnlUsd;
      if (!worst || t.realizedPnlUsd < worst.realizedPnlUsd) worst = t;
    }
  }

  const closed = inWindow.length;
  return {
    fromTs,
    toTs,
    closed,
    wins,
    losses: closed - wins,
    winRatePct: closed > 0 ? (wins / closed) * 100 : 0,
    realizedPnlUsd: realized,
    deployedUsd: deployed,
    roiPct: deployed > 0 ? (realized / deployed) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    best,
    worst,
    rugs,
  };
}

/**
 * The next time the clock reads `hourUtc`:00 UTC, strictly after `nowMs`.
 * Used once at start; after that the alerter steps a fixed schedule forward
 * by whole days, so an early-firing timer can never send the report twice.
 */
export function nextUtcHour(nowMs: number, hourUtc: number): number {
  const d = new Date(nowMs);
  let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc);
  while (next <= nowMs) next += DAY_MS;
  return next;
}

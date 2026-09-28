import type {
  BankrollPoint,
  BucketPerformance,
  StatsWindowKey,
  TradeHighlight,
  TradeStatsWindow,
} from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "../state/db.js";

const log = childLogger("stats-window");

export const WINDOW_MS: Record<StatsWindowKey, number> = {
  "10m": 10 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  all: 0,
};

interface ClosedRow {
  id: string;
  tokenMint: string;
  realizedPnlUsd: number;
  entrySizeUsd: number;
  peakGainPct: number;
  closedAt: Date | null;
  openedAt: Date;
  closeReason: string | null;
  pool: { source: string };
  // rawEvent stores the synthetic mock + name; we use it for token symbol
  // Token symbols aren't stored separately; we'll fall back to short mint.
}

export async function computeStatsWindow(windowKey: StatsWindowKey): Promise<TradeStatsWindow> {
  const start = Date.now();
  const prisma = getPrisma();
  const windowMs = WINDOW_MS[windowKey];
  const toTs = Date.now();
  const fromTs = windowMs === 0 ? 0 : toTs - windowMs;

  // Closed-in-window: closedAt within [fromTs, toTs]
  const closedWhere =
    windowMs === 0
      ? { status: "closed" as const }
      : { status: "closed" as const, closedAt: { gte: new Date(fromTs) } };

  const closed = (await prisma.position.findMany({
    where: closedWhere,
    select: {
      id: true,
      tokenMint: true,
      realizedPnlUsd: true,
      entrySizeUsd: true,
      peakGainPct: true,
      closedAt: true,
      openedAt: true,
      closeReason: true,
      pool: { select: { source: true } },
    },
    orderBy: { closedAt: "desc" },
    take: 10_000,
  })) as unknown as ClosedRow[];

  // Opened-in-window count (any status; used to show activity)
  const positionsOpenedInWindow =
    windowMs === 0
      ? await prisma.position.count()
      : await prisma.position.count({ where: { openedAt: { gte: new Date(fromTs) } } });

  // === Aggregations ===
  const wins = closed.filter((p) => p.realizedPnlUsd > 0).length;
  const losses = closed.length - wins;
  const investedUsd = closed.reduce((s, p) => s + p.entrySizeUsd, 0);
  const realizedPnlUsd = closed.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const totalGrossWinUsd = closed
    .filter((p) => p.realizedPnlUsd > 0)
    .reduce((s, p) => s + p.realizedPnlUsd, 0);
  const totalGrossLossUsd = Math.abs(
    closed.filter((p) => p.realizedPnlUsd < 0).reduce((s, p) => s + p.realizedPnlUsd, 0),
  );
  const winRatePct = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const profitFactor =
    totalGrossLossUsd > 0
      ? totalGrossWinUsd / totalGrossLossUsd
      : totalGrossWinUsd > 0
        ? Infinity
        : 0;

  const winPcts = closed
    .filter((p) => p.realizedPnlUsd > 0 && p.entrySizeUsd > 0)
    .map((p) => (p.realizedPnlUsd / p.entrySizeUsd) * 100);
  const lossPcts = closed
    .filter((p) => p.realizedPnlUsd < 0 && p.entrySizeUsd > 0)
    .map((p) => (p.realizedPnlUsd / p.entrySizeUsd) * 100);
  const avgWinPct = winPcts.length > 0 ? winPcts.reduce((s, x) => s + x, 0) / winPcts.length : 0;
  const avgLossPct =
    lossPcts.length > 0 ? lossPcts.reduce((s, x) => s + x, 0) / lossPcts.length : 0;

  const roiPct =
    env.PAPER_STARTING_BALANCE_USD > 0
      ? (realizedPnlUsd / env.PAPER_STARTING_BALANCE_USD) * 100
      : 0;

  // === Breakdowns ===
  const byDex = bucketBy(closed, (p) => p.pool.source);
  const byCloseReason = bucketBy(closed, (p) => p.closeReason ?? "manual");

  // === Highlights ===
  const topWinner = pickHighlight(closed, "best");
  const topLoser = pickHighlight(closed, "worst");

  // === Bankroll series ===
  // Pull BankrollSnapshot rows in window (sample if too many)
  const seriesWhere =
    windowMs === 0 ? {} : { takenAt: { gte: new Date(fromTs) } };
  const snapshots = await prisma.bankrollSnapshot.findMany({
    where: seriesWhere,
    select: { balanceUsd: true, realizedPnl: true, openExposure: true, takenAt: true },
    orderBy: { takenAt: "asc" },
    take: 1_500,
  });

  // Downsample to ~120 points
  const TARGET_POINTS = 120;
  const step = Math.max(1, Math.ceil(snapshots.length / TARGET_POINTS));
  const bankrollSeries: BankrollPoint[] = [];
  for (let i = 0; i < snapshots.length; i += step) {
    const s = snapshots[i]!;
    bankrollSeries.push({
      ts: s.takenAt.getTime(),
      balanceUsd: s.balanceUsd,
      realizedPnlUsd: s.realizedPnl,
      openExposureUsd: s.openExposure,
    });
  }
  // Always include the most-recent sample if we skipped it
  const last = snapshots[snapshots.length - 1];
  if (last && bankrollSeries[bankrollSeries.length - 1]?.ts !== last.takenAt.getTime()) {
    bankrollSeries.push({
      ts: last.takenAt.getTime(),
      balanceUsd: last.balanceUsd,
      realizedPnlUsd: last.realizedPnl,
      openExposureUsd: last.openExposure,
    });
  }

  log.info(
    {
      windowKey,
      windowMs,
      closedInWindow: closed.length,
      openedInWindow: positionsOpenedInWindow,
      realizedPnlUsd: realizedPnlUsd.toFixed(2),
      durMs: Date.now() - start,
    },
    "stats window computed",
  );

  return {
    windowKey,
    windowMs,
    fromTs,
    toTs,
    positionsOpenedInWindow,
    positionsClosedInWindow: closed.length,
    investedUsd,
    realizedPnlUsd,
    totalGrossWinUsd,
    totalGrossLossUsd,
    wins,
    losses,
    winRatePct,
    profitFactor,
    avgWinPct,
    avgLossPct,
    roiPct,
    byDex,
    byCloseReason,
    topWinner,
    topLoser,
    bankrollSeries,
    takenAt: Date.now(),
  };
}

function bucketBy(rows: ClosedRow[], keyFn: (p: ClosedRow) => string): BucketPerformance[] {
  const buckets = new Map<string, BucketPerformance>();
  for (const p of rows) {
    const label = keyFn(p);
    let b = buckets.get(label);
    if (!b) {
      b = { label, trades: 0, wins: 0, losses: 0, winRatePct: 0, netPnlUsd: 0 };
      buckets.set(label, b);
    }
    b.trades++;
    if (p.realizedPnlUsd > 0) b.wins++;
    else b.losses++;
    b.netPnlUsd += p.realizedPnlUsd;
  }
  for (const b of buckets.values()) {
    b.winRatePct = b.trades > 0 ? (b.wins / b.trades) * 100 : 0;
  }
  return Array.from(buckets.values()).sort((a, b) => b.trades - a.trades);
}

function pickHighlight(rows: ClosedRow[], which: "best" | "worst"): TradeHighlight | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) =>
    which === "best" ? b.realizedPnlUsd - a.realizedPnlUsd : a.realizedPnlUsd - b.realizedPnlUsd,
  );
  const p = sorted[0]!;
  if (which === "best" && p.realizedPnlUsd <= 0) return null;
  if (which === "worst" && p.realizedPnlUsd >= 0) return null;
  return {
    positionId: p.id,
    tokenMint: p.tokenMint,
    tokenSymbol: null,
    source: p.pool.source,
    entrySizeUsd: p.entrySizeUsd,
    realizedPnlUsd: p.realizedPnlUsd,
    realizedPnlPct: p.entrySizeUsd > 0 ? (p.realizedPnlUsd / p.entrySizeUsd) * 100 : 0,
    peakGainPct: p.peakGainPct,
    closeReason: p.closeReason,
    closedAt: p.closedAt?.getTime() ?? Date.now(),
  };
}

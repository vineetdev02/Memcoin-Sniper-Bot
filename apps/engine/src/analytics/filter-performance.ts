import type {
  AnalyticsSnapshot,
  BucketPerformance,
  FilterId,
  FilterPerformance,
} from "@sniperbot/shared";
import { FILTER_ORDER } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "../state/db.js";

const log = childLogger("filter-perf");

const LIQ_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "<$5k", min: 0, max: 5_000 },
  { label: "$5k–$15k", min: 5_000, max: 15_000 },
  { label: "$15k–$50k", min: 15_000, max: 50_000 },
  { label: "$50k–$200k", min: 50_000, max: 200_000 },
  { label: ">$200k", min: 200_000, max: Number.POSITIVE_INFINITY },
];

const SCORE_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "0–40", min: 0, max: 40 },
  { label: "40–60", min: 40, max: 60 },
  { label: "60–75", min: 60, max: 75 },
  { label: "75–90", min: 75, max: 90 },
  { label: "90+", min: 90, max: 1000 },
];

interface ClosedPositionRow {
  id: string;
  poolId: string;
  filterScore: number;
  realizedPnlUsd: number;
  entrySizeUsd: number;
  closedAt: Date | null;
  pool: {
    source: string;
    initialLiquidityUsd: number;
    detectedAt: Date;
    filterResults: { filterId: string; passed: boolean }[];
  };
}

export async function computeAnalytics(): Promise<AnalyticsSnapshot> {
  const start = Date.now();
  const prisma = getPrisma();

  const closed = (await prisma.position.findMany({
    where: { status: "closed" },
    select: {
      id: true,
      poolId: true,
      filterScore: true,
      realizedPnlUsd: true,
      entrySizeUsd: true,
      closedAt: true,
      pool: {
        select: {
          source: true,
          initialLiquidityUsd: true,
          detectedAt: true,
          filterResults: {
            select: { filterId: true, passed: true },
          },
        },
      },
    },
    orderBy: { closedAt: "desc" },
    take: 5_000,
  })) as unknown as ClosedPositionRow[];

  const totalClosed = closed.length;
  const totalWins = closed.filter((p) => p.realizedPnlUsd > 0).length;
  const totalLosses = totalClosed - totalWins;
  const baselineWinRatePct = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
  const netPnlUsd = closed.reduce((s, p) => s + p.realizedPnlUsd, 0);

  const grossWin = closed.filter((p) => p.realizedPnlUsd > 0).reduce((s, p) => s + p.realizedPnlUsd, 0);
  const grossLoss = Math.abs(
    closed.filter((p) => p.realizedPnlUsd < 0).reduce((s, p) => s + p.realizedPnlUsd, 0),
  );
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const filterPerformance = await computeFilterPerf(closed, baselineWinRatePct);

  const byDex = bucketBy(closed, (p) => p.pool.source);
  const byLiquidity = bucketByRange(closed, (p) => p.pool.initialLiquidityUsd, LIQ_BUCKETS);
  const byScoreBucket = bucketByRange(closed, (p) => p.filterScore, SCORE_BUCKETS);
  const byHour = bucketByRange(
    closed,
    (p) => new Date(p.pool.detectedAt).getUTCHours(),
    Array.from({ length: 24 }, (_, h) => ({ label: `${h.toString().padStart(2, "0")}:00`, min: h, max: h + 0.999 })),
  );

  log.info(
    {
      durMs: Date.now() - start,
      totalClosed,
      baselineWinRatePct: baselineWinRatePct.toFixed(1),
      netPnlUsd: netPnlUsd.toFixed(2),
    },
    "analytics computed",
  );

  return {
    totalClosed,
    baselineWinRatePct,
    netPnlUsd,
    profitFactor,
    filterPerformance,
    byDex,
    byLiquidity,
    byHour,
    byScoreBucket,
    takenAt: Date.now(),
  };
}

async function computeFilterPerf(
  closed: ClosedPositionRow[],
  baselineWinRatePct: number,
): Promise<FilterPerformance[]> {
  const prisma = getPrisma();
  // Rejected pool count per filter — count of failed filter results across ALL pools (not just snipes).
  const rejectedAgg = await prisma.filterResult.groupBy({
    by: ["filterId", "passed"],
    _count: { _all: true },
  });
  const rejectedByFilter = new Map<string, number>();
  for (const row of rejectedAgg) {
    if (!row.passed) rejectedByFilter.set(row.filterId, row._count._all);
  }

  const out: FilterPerformance[] = [];
  for (const filterId of FILTER_ORDER) {
    let passedTrades = 0;
    let passedWins = 0;
    let passedLosses = 0;
    let netPnlUsd = 0;
    for (const p of closed) {
      const r = p.pool.filterResults.find((x) => x.filterId === filterId);
      if (!r || !r.passed) continue;
      passedTrades++;
      if (p.realizedPnlUsd > 0) passedWins++;
      else passedLosses++;
      netPnlUsd += p.realizedPnlUsd;
    }
    const passedWinRatePct = passedTrades > 0 ? (passedWins / passedTrades) * 100 : 0;
    const avgPnlUsd = passedTrades > 0 ? netPnlUsd / passedTrades : 0;
    out.push({
      filterId,
      passedTrades,
      passedWins,
      passedLosses,
      passedWinRatePct,
      rejected: rejectedByFilter.get(filterId) ?? 0,
      netPnlUsd,
      avgPnlUsd,
      liftPct: passedTrades > 0 ? passedWinRatePct - baselineWinRatePct : 0,
    });
  }
  return out;
}

function bucketBy(
  closed: ClosedPositionRow[],
  keyFn: (p: ClosedPositionRow) => string,
): BucketPerformance[] {
  const buckets = new Map<string, BucketPerformance>();
  for (const p of closed) {
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

function bucketByRange(
  closed: ClosedPositionRow[],
  valueFn: (p: ClosedPositionRow) => number,
  ranges: Array<{ label: string; min: number; max: number }>,
): BucketPerformance[] {
  const out: BucketPerformance[] = ranges.map((r) => ({
    label: r.label,
    trades: 0,
    wins: 0,
    losses: 0,
    winRatePct: 0,
    netPnlUsd: 0,
  }));
  for (const p of closed) {
    const v = valueFn(p);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      const slot = out[i]!;
      if (v >= r.min && v <= r.max) {
        slot.trades++;
        if (p.realizedPnlUsd > 0) slot.wins++;
        else slot.losses++;
        slot.netPnlUsd += p.realizedPnlUsd;
        break;
      }
    }
  }
  for (const b of out) {
    b.winRatePct = b.trades > 0 ? (b.wins / b.trades) * 100 : 0;
  }
  return out;
}

import type {
  BacktestSummary,
  FilterConfigDelta,
  FilterId,
  PoolEvent,
} from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "../state/db.js";
import { env } from "../config/env.js";
import type { ResolvedFilterConfig } from "../config/filter-config.js";
import type { FilterOrchestrator } from "../filters/orchestrator.js";

const log = childLogger("backtest");

interface PoolRow {
  poolAddress: string;
  tokenMint: string;
  baseMint: string;
  source: string;
  initialLiquidityUsd: number;
  initialPriceUsd: number;
  creatorWallet: string;
  detectedAt: Date;
  signature: string;
  rawEvent: unknown;
}

export interface BacktestRequest {
  presetName: string;
  delta: FilterConfigDelta;
  limit: number;
}

/**
 * Replay the most recent N persisted PoolEvents through the orchestrator with
 * a temporary preset, count snipes/rejects per filter. No state is mutated.
 */
export async function runBacktest(
  orchestrator: FilterOrchestrator,
  req: BacktestRequest,
): Promise<BacktestSummary> {
  const start = Date.now();

  const cfg = buildResolvedConfig(req.delta);

  let snipes = 0;
  let rejects = 0;
  const passCounts: Record<string, number> = {};
  const failCounts: Record<string, number> = {};

  const onVerdict = (v: { decision: string; results: { filterId: string; status: string }[] }) => {
    if (v.decision === "snipe") snipes++;
    else rejects++;
    for (const r of v.results) {
      if (r.status === "pass") passCounts[r.filterId] = (passCounts[r.filterId] ?? 0) + 1;
      if (r.status === "fail") failCounts[r.filterId] = (failCounts[r.filterId] ?? 0) + 1;
    }
  };
  orchestrator.on("verdict-backtest", onVerdict);

  const pools = await loadPools(req.limit);
  log.info({ count: pools.length, preset: req.presetName }, "backtest replay starting");

  for (const p of pools) {
    await orchestrator.evaluate(p, { persist: false, configOverride: cfg });
  }
  await orchestrator.drain();

  orchestrator.off("verdict-backtest", onVerdict);

  const summary: BacktestSummary = {
    presetName: req.presetName,
    poolsReplayed: pools.length,
    snipes,
    rejects,
    acceptanceRatePct: pools.length > 0 ? (snipes / pools.length) * 100 : 0,
    totalDurationMs: Date.now() - start,
    filterPassCounts: passCounts,
    filterFailCounts: failCounts,
    takenAt: Date.now(),
  };
  log.info(summary, "backtest complete");
  return summary;
}

function buildResolvedConfig(d: FilterConfigDelta): ResolvedFilterConfig {
  const t = d.thresholds ?? {};
  const enabledMap = d.enabled ?? {};
  return {
    enabled: (id: FilterId) => enabledMap[id] ?? true,
    liquidityMinUsd: t.liquidityMinUsd ?? env.FILTER_LIQUIDITY_MIN_USD,
    liquidityMaxUsd: t.liquidityMaxUsd ?? env.FILTER_LIQUIDITY_MAX_USD,
    lpLockedRequired: t.lpLockedRequired ?? env.FILTER_LP_LOCKED_REQUIRED,
    mintAuthRenounced: t.mintAuthRenounced ?? env.FILTER_MINT_AUTH_RENOUNCED,
    freezeAuthRenounced: t.freezeAuthRenounced ?? env.FILTER_FREEZE_AUTH_RENOUNCED,
    topHolderMaxPct: t.topHolderMaxPct ?? env.FILTER_TOP_HOLDER_MAX_PCT,
    top10HoldersMaxPct: t.top10HoldersMaxPct ?? env.FILTER_TOP_10_HOLDERS_MAX_PCT,
    devRugRateMax: t.devRugRateMax ?? env.FILTER_DEV_RUG_RATE_MAX,
    honeypotSimRequired: t.honeypotSimRequired ?? env.FILTER_HONEYPOT_SIM_REQUIRED,
    maxSellTaxPct: t.maxSellTaxPct ?? env.FILTER_MAX_SELL_TAX_PCT,
    bundledLaunchReject: t.bundledLaunchReject ?? env.FILTER_BUNDLED_LAUNCH_REJECT,
    minFilterScore: t.minFilterScore ?? env.FILTER_MIN_FILTER_SCORE,
  };
}

async function loadPools(limit: number): Promise<PoolEvent[]> {
  const rows = (await getPrisma().pool.findMany({
    orderBy: { detectedAt: "desc" },
    take: limit,
  })) as PoolRow[];
  return rows.reverse().map(rowToEvent);
}

function rowToEvent(r: PoolRow): PoolEvent {
  return {
    poolAddress: r.poolAddress,
    tokenMint: r.tokenMint,
    baseMint: r.baseMint,
    source: r.source as PoolEvent["source"],
    initialLiquidityUsd: r.initialLiquidityUsd,
    initialPriceUsd: r.initialPriceUsd,
    creatorWallet: r.creatorWallet,
    detectedAt: r.detectedAt.getTime(),
    signature: r.signature,
    rawEvent: r.rawEvent ?? null,
  };
}

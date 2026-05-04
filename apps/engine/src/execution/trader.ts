import { randomUUID } from "node:crypto";
import type { OrchestratorVerdict, PoolEvent, Position } from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { buildTPLadder, PositionStore } from "../state/position-store.js";
import { paperExecutor, buyResultToTrade } from "./paper-executor.js";
import { buildProfile } from "./price-simulator.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";

const log = childLogger("trader");

export class Trader {
  private readonly store: PositionStore;
  private readonly pnl: PnlTracker;
  private readonly recentEntries: number[] = [];
  private skippedFull = 0;
  private skippedRate = 0;
  private skippedExposure = 0;
  private failedFills = 0;

  private readonly recentPools = new Map<string, { pool: PoolEvent; cachedAt: number }>();

  constructor(store: PositionStore, pnl: PnlTracker) {
    this.store = store;
    this.pnl = pnl;
  }

  cachePool(pool: PoolEvent): void {
    this.recentPools.set(pool.poolAddress, { pool, cachedAt: Date.now() });
    // Sweep entries older than 60s
    if (this.recentPools.size > 200) {
      const cutoff = Date.now() - 60_000;
      for (const [addr, rec] of this.recentPools) {
        if (rec.cachedAt < cutoff) this.recentPools.delete(addr);
      }
    }
  }

  /** Look up + drop the matching pool for a verdict. */
  resolvePool(verdict: OrchestratorVerdict): PoolEvent | null {
    const rec = this.recentPools.get(verdict.poolAddress);
    if (!rec) return null;
    this.recentPools.delete(verdict.poolAddress);
    return rec.pool;
  }

  getStats() {
    return {
      skippedFull: this.skippedFull,
      skippedRate: this.skippedRate,
      skippedExposure: this.skippedExposure,
      failedFills: this.failedFills,
    };
  }

  /** Handle a snipe verdict — open a paper position if checks pass. */
  handleVerdict(verdict: OrchestratorVerdict, pool: PoolEvent): void {
    if (verdict.decision !== "snipe") return;

    if (this.store.count() >= env.MAX_CONCURRENT_POSITIONS) {
      this.skippedFull++;
      return;
    }

    // Rate limit: max N entries in 60s
    const now = Date.now();
    while (this.recentEntries.length && now - this.recentEntries[0]! > 60_000) {
      this.recentEntries.shift();
    }
    if (this.recentEntries.length >= env.MAX_POSITION_PER_MIN) {
      this.skippedRate++;
      log.warn({ limit: env.MAX_POSITION_PER_MIN }, "rate limit: skipping snipe");
      return;
    }

    const snap = this.pnl.buildSnapshot();
    const exposurePct = (snap.openExposureUsd / snap.balanceUsd) * 100;
    if (exposurePct >= env.MAX_TOTAL_EXPOSURE_PCT) {
      this.skippedExposure++;
      log.warn({ exposurePct: exposurePct.toFixed(1) }, "exposure cap: skipping snipe");
      return;
    }

    const sizeUsd = snap.balanceUsd * (env.POSITION_SIZE_PCT / 100);
    const result = paperExecutor.buy(verdict, pool, sizeUsd);

    if (result.status === "failed") {
      this.failedFills++;
      // Failed fills cost the fee — record as a tiny realized loss via a "ghost" closed position?
      // Simpler: just log for now; PnL only counts filled positions.
      return;
    }

    this.recentEntries.push(now);

    const tokenSymbol = (pool.rawEvent as { name?: string } | undefined)?.name;
    const positionId = randomUUID();
    const position: Position = {
      id: positionId,
      poolAddress: pool.poolAddress,
      tokenMint: pool.tokenMint,
      tokenSymbol,
      source: pool.source,
      mode: env.MODE,
      entryPriceUsd: result.effectivePriceUsd,
      entrySizeUsd: sizeUsd,
      initialTokens: result.tokensReceived,
      remainingTokens: result.tokensReceived,
      currentPriceUsd: result.effectivePriceUsd,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      realizedPnlUsd: 0,
      peakPriceUsd: result.effectivePriceUsd,
      peakGainPct: 0,
      tpLadder: buildTPLadder(env.TP_LADDER),
      stopLossPct: env.STOP_LOSS_PCT,
      trailingStopPct: env.TRAILING_STOP_PCT,
      trailingStopActivationPct: env.TRAILING_STOP_ACTIVATION_PCT,
      trailingStopArmed: false,
      timeExitMin: env.TIME_EXIT_MIN,
      filterScore: verdict.totalScore,
      openedAt: result.fillTime,
      status: "open",
    };

    const profile = buildProfile(pool, result.fillTime, result.effectivePriceUsd);
    const buyTrade = buyResultToTrade(positionId, result);

    this.store.add(position, profile, buyTrade);
  }
}

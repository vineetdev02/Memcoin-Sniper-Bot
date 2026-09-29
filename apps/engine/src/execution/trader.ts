import { randomUUID } from "node:crypto";
import type { OrchestratorVerdict, PoolEvent, Position } from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { buildTPLadder, PositionStore } from "../state/position-store.js";
import { paperExecutor, buyResultToTrade, type EntryMarket } from "./paper-executor.js";
import { buildProfile, isSyntheticPool } from "./price-simulator.js";
import type { MarketFeed } from "./market-price.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";
import type { DrawdownCircuit } from "../risk/drawdown-circuit.js";

const log = childLogger("trader");

export class Trader {
  private readonly store: PositionStore;
  private readonly pnl: PnlTracker;
  private readonly circuit: DrawdownCircuit;
  private readonly feed: MarketFeed | null;
  private readonly recentEntries: number[] = [];
  // entries past every check, waiting for their market price
  private pendingEntries = 0;
  private skippedFull = 0;
  private skippedRate = 0;
  private skippedExposure = 0;
  private skippedHalted = 0;
  private skippedDisabled = 0;
  private skippedNoPrice = 0;
  private failedFills = 0;
  // Off at every start: nothing opens until someone presses Start on the dashboard.
  private enabled = false;

  private readonly recentPools = new Map<string, { pool: PoolEvent; cachedAt: number }>();

  constructor(store: PositionStore, pnl: PnlTracker, circuit: DrawdownCircuit, feed: MarketFeed | null = null) {
    this.store = store;
    this.pnl = pnl;
    this.circuit = circuit;
    this.feed = feed;
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
      skippedHalted: this.skippedHalted,
      skippedDisabled: this.skippedDisabled,
      skippedNoPrice: this.skippedNoPrice,
      failedFills: this.failedFills,
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Gates new entries only. Open positions keep their exits either way —
   * stopping must never strand a position without its stop-loss.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    log.warn({ mode: env.MODE }, on ? "trading STARTED from dashboard" : "trading STOPPED from dashboard");
  }

  /**
   * Handle a snipe verdict — open a paper position if checks pass. A real pool
   * is bought at its market price at this moment; a pool nobody quotes is not
   * bought at all, since nothing could be known about the fill.
   */
  async handleVerdict(verdict: OrchestratorVerdict, pool: PoolEvent): Promise<void> {
    if (verdict.decision !== "snipe") return;

    if (!this.enabled) {
      this.skippedDisabled++;
      return;
    }

    const gate = this.circuit.canTrade();
    if (!gate.allowed) {
      this.skippedHalted++;
      log.warn({ reason: gate.reason, mint: pool.tokenMint.slice(0, 8) }, "circuit blocked snipe");
      return;
    }

    if (this.store.count() + this.pendingEntries >= env.MAX_CONCURRENT_POSITIONS) {
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

    // Hold the slot while the price is fetched, so concurrent snipes cannot
    // all slip through the checks above; give it back if nothing opens.
    this.recentEntries.push(now);
    this.pendingEntries++;
    let opened = false;
    try {
      opened = await this.open(verdict, pool, sizeUsd);
    } catch (err) {
      log.error({ err, mint: pool.tokenMint.slice(0, 8) }, "entry failed");
    } finally {
      this.pendingEntries--;
      if (!opened) {
        const i = this.recentEntries.lastIndexOf(now);
        if (i >= 0) this.recentEntries.splice(i, 1);
      }
    }
  }

  private async open(verdict: OrchestratorVerdict, pool: PoolEvent, sizeUsd: number): Promise<boolean> {
    const synthetic = isSyntheticPool(pool);
    let market: EntryMarket | undefined;
    if (!synthetic) {
      // Enter at what a real buy of this size would pay, and only when the
      // price index agrees — an index 114× too high once cost a whole position.
      const entry = this.feed
        ? await this.feed.entryQuote(pool.tokenMint, sizeUsd)
        : { ok: false as const, reason: "no market feed" };
      if (!entry.ok) {
        this.skippedNoPrice++;
        log.warn({ mint: pool.tokenMint.slice(0, 8), reason: entry.reason }, "no trustworthy entry price — not trading it");
        return false;
      }
      market = { priceUsd: entry.priceUsd, liquidityUsd: entry.liquidityUsd, priceIncludesImpact: true };
    }
    if (!this.enabled) {
      // switched off while the price was being fetched
      this.skippedDisabled++;
      return false;
    }

    const result = paperExecutor.buy(verdict, pool, sizeUsd, market);
    if (result.status === "failed") {
      this.failedFills++;
      // Failed fills cost the fee — record as a tiny realized loss via a "ghost" closed position?
      // Simpler: just log for now; PnL only counts filled positions.
      return false;
    }

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

    // only a synthetic pool's price is simulated; a real one is priced by the feed
    const profile = synthetic ? buildProfile(pool, result.fillTime, result.effectivePriceUsd) : undefined;
    const buyTrade = buyResultToTrade(positionId, result);

    this.store.add(position, profile, buyTrade);
    return true;
  }
}

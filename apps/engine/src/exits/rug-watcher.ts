import { childLogger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { fetchPair, invalidate } from "../feeds/dexscreener-client.js";
import type { PositionStore } from "../state/position-store.js";
import type { ExitEngine } from "./exit-engine.js";

const log = childLogger("rug-watcher");

interface WatchEntry {
  positionId: string;
  poolAddress: string;
  baselineLiquidityUsd: number;
  lastLiquidityUsd: number;
  consecutiveMissing: number;
}

const POLL_INTERVAL_MS = 5_000;
const MAX_CONSECUTIVE_MISSES = 5; // ~25s of no data → stop polling (likely synthetic / not indexed)

/**
 * Real-mode rug-pull watcher. Polls DexScreener liquidity for each open
 * position; on a drop > RUG_DETECTION_LP_DROP_PCT from the baseline, forces an
 * emergency close through the exit-engine. Skipped entirely when the synthetic
 * feed is active — the price-simulator already drives rug exits there.
 */
export class RugWatcher {
  private timer: NodeJS.Timeout | null = null;
  private readonly entries = new Map<string, WatchEntry>();
  private readonly store: PositionStore;
  private readonly exits: ExitEngine;
  private readonly dropPct: number;
  private detections = 0;

  constructor(store: PositionStore, exits: ExitEngine) {
    this.store = store;
    this.exits = exits;
    this.dropPct = env.RUG_DETECTION_LP_DROP_PCT;
  }

  start(): void {
    if (this.timer) return;
    if (env.SYNTHETIC_FEED) {
      log.info("synthetic feed active — rug-watcher disabled (price-simulator handles rugs)");
      return;
    }
    this.store.on("position-opened", (e) => this.watch(e.position.id, e.position.poolAddress));
    this.store.on("position-closed", (e) => this.unwatch(e.position.id));
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    log.info({ pollMs: POLL_INTERVAL_MS, dropPct: this.dropPct }, "rug-watcher started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.entries.clear();
  }

  getStats() {
    return { tracked: this.entries.size, detections: this.detections };
  }

  private async watch(positionId: string, poolAddress: string): Promise<void> {
    // Establish baseline liquidity. Use the *first* DexScreener reading we can
    // get (within ~30s) so a tiny entry liquidity in the pool record doesn't
    // produce false rugs against a now-much-bigger pool.
    invalidate(poolAddress);
    const pair = await fetchPair(poolAddress);
    const liq = pair?.liquidity?.usd ?? 0;
    if (liq <= 0) {
      log.debug({ positionId, poolAddress }, "no liquidity baseline yet — will retry next poll");
    }
    this.entries.set(positionId, {
      positionId,
      poolAddress,
      baselineLiquidityUsd: liq,
      lastLiquidityUsd: liq,
      consecutiveMissing: 0,
    });
  }

  private unwatch(positionId: string): void {
    this.entries.delete(positionId);
  }

  private async poll(): Promise<void> {
    if (this.entries.size === 0) return;
    const entries = [...this.entries.values()];
    await Promise.all(entries.map((e) => this.checkOne(e)));
  }

  private async checkOne(entry: WatchEntry): Promise<void> {
    // Bypass cache so we get a fresh reading each poll
    invalidate(entry.poolAddress);
    const pair = await fetchPair(entry.poolAddress);
    const liq = pair?.liquidity?.usd;
    if (liq === undefined || liq === null) {
      entry.consecutiveMissing++;
      if (entry.consecutiveMissing >= MAX_CONSECUTIVE_MISSES) {
        log.warn({ ...entry }, "dropping rug watch — pool not indexed by DexScreener");
        this.entries.delete(entry.positionId);
      }
      return;
    }
    entry.consecutiveMissing = 0;

    // First successful reading — lock in baseline
    if (entry.baselineLiquidityUsd <= 0) {
      entry.baselineLiquidityUsd = liq;
      entry.lastLiquidityUsd = liq;
      log.info(
        { positionId: entry.positionId, baselineLiquidityUsd: liq },
        "rug-watcher baseline set",
      );
      return;
    }

    entry.lastLiquidityUsd = liq;
    const dropPct = ((entry.baselineLiquidityUsd - liq) / entry.baselineLiquidityUsd) * 100;
    if (dropPct >= this.dropPct) {
      this.detections++;
      log.warn(
        {
          positionId: entry.positionId,
          pool: entry.poolAddress,
          baselineUsd: entry.baselineLiquidityUsd.toFixed(0),
          currentUsd: liq.toFixed(0),
          dropPct: dropPct.toFixed(1),
        },
        "RUG DETECTED — forcing emergency close",
      );
      this.exits.forceClose(entry.positionId, "rug-pull");
      this.entries.delete(entry.positionId);
    }
  }
}

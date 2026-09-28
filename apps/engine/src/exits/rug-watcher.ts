import { childLogger } from "../utils/logger.js";
import { env } from "../config/env.js";
import type { MarketFeed } from "../execution/market-price.js";
import type { PositionStore } from "../state/position-store.js";
import type { ExitEngine } from "./exit-engine.js";

const log = childLogger("rug-watcher");

const POLL_INTERVAL_MS = 5_000;

/**
 * Real-mode rug watch. Reads each open position's liquidity from the market
 * feed and, on a drop of RUG_DETECTION_LP_DROP_PCT from the first reading,
 * forces an emergency close through the exit engine.
 *
 * It used to ask DexScreener's pairs endpoint about the token mint, which
 * always answers with no pair — so it never saw a real pool, and the only
 * "rug-pull" exits were the price simulator's. Positions on synthetic pools
 * keep those simulated rugs and are skipped here.
 */
export class RugWatcher {
  private timer: NodeJS.Timeout | null = null;
  private readonly store: PositionStore;
  private readonly exits: ExitEngine;
  private readonly feed: MarketFeed;
  private readonly dropPct: number;
  // position id → liquidity at the first reading
  private readonly baselines = new Map<string, number>();
  private detections = 0;

  constructor(store: PositionStore, exits: ExitEngine, feed: MarketFeed) {
    this.store = store;
    this.exits = exits;
    this.feed = feed;
    this.dropPct = env.RUG_DETECTION_LP_DROP_PCT;
  }

  start(): void {
    if (this.timer) return;
    if (env.SYNTHETIC_FEED) {
      log.info("synthetic feed active — rug-watcher disabled (price-simulator handles rugs)");
      return;
    }
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    log.info({ pollMs: POLL_INTERVAL_MS, dropPct: this.dropPct }, "rug-watcher started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.baselines.clear();
  }

  getStats() {
    return { tracked: this.baselines.size, detections: this.detections };
  }

  poll(): void {
    const open = new Set<string>();
    for (const p of this.store.list()) {
      open.add(p.id);
      if (this.store.get(p.id)?.profile) continue;
      const liq = this.feed.get(p.tokenMint)?.liquidityUsd;
      if (liq === undefined || liq === null) continue;

      const baseline = this.baselines.get(p.id);
      if (baseline === undefined) {
        this.baselines.set(p.id, liq);
        continue;
      }
      if (baseline <= 0) continue;

      const dropPct = ((baseline - liq) / baseline) * 100;
      if (dropPct >= this.dropPct) {
        this.detections++;
        log.warn(
          {
            positionId: p.id,
            mint: p.tokenMint.slice(0, 8),
            baselineUsd: baseline.toFixed(0),
            currentUsd: liq.toFixed(0),
            dropPct: dropPct.toFixed(1),
          },
          "RUG DETECTED — forcing emergency close",
        );
        this.exits.forceClose(p.id, "rug-pull");
        this.baselines.delete(p.id);
      }
    }
    for (const id of this.baselines.keys()) if (!open.has(id)) this.baselines.delete(id);
  }
}

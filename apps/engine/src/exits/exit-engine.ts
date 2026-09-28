import type { ExitReason, Position } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { paperExecutor, sellResultToTrade } from "../execution/paper-executor.js";
import { liquidityAt, priceAt } from "../execution/price-simulator.js";
import type { MarketFeed } from "../execution/market-price.js";
import type { PositionRecord, PositionStore } from "../state/position-store.js";

const log = childLogger("exit-engine");

const TP_REASONS: ExitReason[] = ["tp1", "tp2", "tp3", "tp4"];

// How long a token past its time window may go unpriced before it is written
// off. Long enough that a restart's first empty ticks never trigger it.
const UNPRICED_WRITE_OFF_MS = 3 * 60_000;

interface MarketNow {
  priceUsd: number;
  liquidityUsd: number;
  rugAt: number | null;
}

interface ExitDecision {
  kind: "partial-tp" | "full-close" | "none";
  reason?: ExitReason;
  tokensToSell?: number;
  tpIndex?: number;
}

export class ExitEngine {
  private timer: NodeJS.Timeout | null = null;
  private readonly store: PositionStore;
  /**
   * Multiplier on wall-clock ms → simulated ms for price evolution.
   * Default 30x so a 30-min time-exit is reachable in 1 wall-clock minute.
   */
  private readonly timeScale: number;
  private readonly tickMs = 1000;
  private readonly market: MarketFeed | null;
  private readonly unpricedSince = new Map<string, number>();
  private rugBroadcasts = 0;
  private partialFills = 0;
  private fullCloses = 0;

  constructor(store: PositionStore, timeScale = 30, market: MarketFeed | null = null) {
    this.store = store;
    this.timeScale = Math.max(1, timeScale);
    this.market = market;
  }

  /** Price and liquidity now: simulated for a synthetic pool, the market's for a real one. */
  private marketFor(rec: PositionRecord, simElapsed: number): MarketNow | null {
    if (rec.profile) {
      return {
        priceUsd: priceAt(rec.profile, simElapsed),
        liquidityUsd: liquidityAt(rec.profile, simElapsed),
        rugAt: rec.profile.rugAt,
      };
    }
    const q = this.market?.get(rec.position.tokenMint);
    // a real pool's rugs are caught by the rug watcher, not simulated
    return q ? { priceUsd: q.priceUsd, liquidityUsd: q.liquidityUsd ?? 0, rugAt: null } : null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    log.info({ tickMs: this.tickMs, timeScale: this.timeScale }, "exit engine started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStats() {
    return {
      timeScale: this.timeScale,
      partialFills: this.partialFills,
      fullCloses: this.fullCloses,
      rugBroadcasts: this.rugBroadcasts,
    };
  }

  private tick(): void {
    const now = Date.now();
    for (const p of this.store.list()) {
      const rec = this.store.get(p.id);
      if (!rec) continue;
      const wallElapsed = now - p.openedAt;
      const simElapsed = wallElapsed * this.timeScale;
      const m = this.marketFor(rec, simElapsed);
      if (!m) {
        this.handleUnpriced(rec, now, simElapsed);
        continue;
      }
      this.unpricedSince.delete(p.id);
      const updated = this.store.tickPrice(p.id, m.priceUsd);
      if (!updated) continue;

      const decision = this.evaluate(updated, simElapsed, m.rugAt);
      if (decision.kind === "partial-tp") {
        this.partialFills++;
        const liq = m.liquidityUsd;
        const sell = paperExecutor.sell(
          updated.entryPriceUsd,
          updated.currentPriceUsd,
          decision.tokensToSell!,
          liq,
          decision.reason!,
        );
        const trade = sellResultToTrade(updated.id, sell);
        this.store.applyPartialSell(updated.id, sell.tokensSold, sell.proceedsUsd, trade, decision.tpIndex!);
      } else if (decision.kind === "full-close") {
        this.fullCloses++;
        if (decision.reason === "rug-pull") this.rugBroadcasts++;
        const liq = m.liquidityUsd;
        const sell = paperExecutor.sell(
          updated.entryPriceUsd,
          updated.currentPriceUsd,
          updated.remainingTokens,
          liq,
          decision.reason!,
        );
        const trade = sellResultToTrade(updated.id, sell);
        this.store.closeFully(updated.id, sell.proceedsUsd, trade, decision.reason!);
        continue;
      }
      this.store.emitUpdate(updated.id);
    }
  }

  /**
   * A token nobody quotes cannot be sold, so its paper value is gone. It is
   * written off at $0 once its time window has passed and it has stayed
   * unpriced for a while; before that it simply waits for a price.
   */
  private handleUnpriced(rec: PositionRecord, now: number, simElapsed: number): void {
    const p = rec.position;
    const since = this.unpricedSince.get(p.id) ?? now;
    this.unpricedSince.set(p.id, since);
    const pastWindow = simElapsed >= p.timeExitMin * 60_000;
    if (!pastWindow || now - since < UNPRICED_WRITE_OFF_MS) return;
    this.unpricedSince.delete(p.id);
    this.fullCloses++;
    const sell = paperExecutor.sell(p.entryPriceUsd, 0, p.remainingTokens, 0, "time-exit");
    this.store.closeFully(p.id, sell.proceedsUsd, sellResultToTrade(p.id, sell), "time-exit");
    log.warn({ id: p.id.slice(0, 8), mint: p.tokenMint.slice(0, 8) }, "no market price past the time window — written off at $0");
  }

  private evaluate(p: Position, simElapsedMs: number, rugAt: number | null): ExitDecision {
    // 1. Rug pull (highest priority)
    if (rugAt !== null && simElapsedMs >= rugAt && p.unrealizedPnlPct < -50) {
      return { kind: "full-close", reason: "rug-pull" };
    }

    // 2. Stop loss
    if (p.unrealizedPnlPct <= p.stopLossPct) {
      return { kind: "full-close", reason: "stop-loss" };
    }

    // 3. Trailing stop (only after armed)
    if (p.trailingStopArmed && p.peakPriceUsd > 0) {
      const dropPct = ((p.peakPriceUsd - p.currentPriceUsd) / p.peakPriceUsd) * 100;
      if (dropPct >= p.trailingStopPct) {
        return { kind: "full-close", reason: "trailing-stop" };
      }
    }

    // 4. TP ladder — check from highest unhit
    for (let i = p.tpLadder.length - 1; i >= 0; i--) {
      const tp = p.tpLadder[i];
      if (!tp || tp.hit) continue;
      if (p.unrealizedPnlPct >= tp.gainPct) {
        const tokensToSell = (p.initialTokens * tp.sellPct) / 100;
        const reason = TP_REASONS[i] ?? "manual";
        // If this would empty the position (or be the last unhit TP), full-close instead
        const sellsRemaining = p.tpLadder.slice(i + 1).every((t) => t?.hit);
        if (sellsRemaining && tokensToSell >= p.remainingTokens * 0.95) {
          return { kind: "full-close", reason };
        }
        return {
          kind: "partial-tp",
          reason,
          tokensToSell: Math.min(tokensToSell, p.remainingTokens),
          tpIndex: i,
        };
      }
    }

    // 5. Time exit — if no +50% within configured window
    const ageMs = simElapsedMs;
    const exitWindowMs = p.timeExitMin * 60_000;
    if (ageMs >= exitWindowMs && p.peakGainPct < 50) {
      return { kind: "full-close", reason: "time-exit" };
    }

    return { kind: "none" };
  }

  /** Force-close a single position at current price with a given reason. */
  forceClose(positionId: string, reason: ExitReason): void {
    const rec = this.store.get(positionId);
    if (!rec) return;
    const p = rec.position;
    const simElapsed = (Date.now() - p.openedAt) * this.timeScale;
    const liq = this.marketFor(rec, simElapsed)?.liquidityUsd ?? 0;
    const sell = paperExecutor.sell(
      p.entryPriceUsd,
      p.currentPriceUsd,
      p.remainingTokens,
      liq,
      reason,
    );
    const trade = sellResultToTrade(p.id, sell);
    this.fullCloses++;
    if (reason === "rug-pull") this.rugBroadcasts++;
    this.store.closeFully(p.id, sell.proceedsUsd, trade, reason);
    log.warn({ id: p.id.slice(0, 8), reason }, "forced close");
  }

  /** Force-close every open position (kill switch). */
  killAll(): void {
    for (const p of this.store.list()) {
      const rec = this.store.get(p.id);
      if (!rec) continue;
      const simElapsed = (Date.now() - p.openedAt) * this.timeScale;
      const liq = this.marketFor(rec, simElapsed)?.liquidityUsd ?? 0;
      const sell = paperExecutor.sell(
        p.entryPriceUsd,
        p.currentPriceUsd,
        p.remainingTokens,
        liq,
        "kill-switch",
      );
      const trade = sellResultToTrade(p.id, sell);
      this.store.closeFully(p.id, sell.proceedsUsd, trade, "kill-switch");
    }
    log.warn("kill switch: all positions closed");
  }
}

export function defaultStopLossPct(): number {
  return env.STOP_LOSS_PCT;
}

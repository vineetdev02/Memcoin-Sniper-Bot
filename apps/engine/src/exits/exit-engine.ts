import type { ExitReason, Position } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { paperExecutor, sellResultToTrade } from "../execution/paper-executor.js";
import { liquidityAt, priceAt } from "../execution/price-simulator.js";
import { PositionStore } from "../state/position-store.js";

const log = childLogger("exit-engine");

const TP_REASONS: ExitReason[] = ["tp1", "tp2", "tp3", "tp4"];

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
  private rugBroadcasts = 0;
  private partialFills = 0;
  private fullCloses = 0;

  constructor(store: PositionStore, timeScale = 30) {
    this.store = store;
    this.timeScale = Math.max(1, timeScale);
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
      const newPrice = priceAt(rec.profile, simElapsed);
      const updated = this.store.tickPrice(p.id, newPrice);
      if (!updated) continue;

      const decision = this.evaluate(updated, simElapsed, rec.profile.rugAt);
      if (decision.kind === "partial-tp") {
        this.partialFills++;
        const liq = liquidityAt(rec.profile, simElapsed);
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
        const liq = liquidityAt(rec.profile, simElapsed);
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
    const liq = liquidityAt(rec.profile, simElapsed);
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
      const liq = liquidityAt(rec.profile, simElapsed);
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

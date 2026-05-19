import { EventEmitter } from "node:events";
import type { Position } from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import type { PositionStore } from "../state/position-store.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";

const log = childLogger("circuit");

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const DAILY_HALT_MS = DAY_MS;
const WEEKLY_HALT_MS = 3 * DAY_MS;
const CONSECUTIVE_HALT_MS = DAY_MS;

export type HaltReason = "daily-drawdown" | "weekly-drawdown" | "consecutive-losses";

export interface HaltState {
  reason: HaltReason;
  triggeredAt: number;
  untilTs: number;
  detail: string;
}

interface CircuitEvents {
  "halt-engaged": (state: HaltState) => void;
  "halt-cleared": () => void;
}

export declare interface DrawdownCircuit {
  on<E extends keyof CircuitEvents>(event: E, listener: CircuitEvents[E]): this;
  emit<E extends keyof CircuitEvents>(event: E, ...args: Parameters<CircuitEvents[E]>): boolean;
}

interface ClosedRecord {
  closedAt: number;
  realizedPnlUsd: number;
}

/**
 * Drawdown circuit breaker — halts new entries when realized PnL trips one of
 * three limits from plan §10:
 *   • daily loss exceeds DAILY_DRAWDOWN_LIMIT_PCT of current bankroll  → 24h halt
 *   • weekly loss exceeds WEEKLY_DRAWDOWN_LIMIT_PCT                    → 72h halt
 *   • HALT_ON_CONSECUTIVE_LOSSES losses in a row                       → 24h halt
 *
 * The circuit *only* gates new entries. Open positions continue to be managed
 * by the exit engine — exits are always allowed, even during a halt, so
 * stop-losses and TPs still fire.
 */
export class DrawdownCircuit extends EventEmitter {
  private readonly store: PositionStore;
  private readonly pnl: PnlTracker;
  private readonly history: ClosedRecord[] = [];
  private consecutiveLosses = 0;
  private halt: HaltState | null = null;
  private clearTimer: NodeJS.Timeout | null = null;

  constructor(store: PositionStore, pnl: PnlTracker) {
    super();
    this.store = store;
    this.pnl = pnl;
  }

  start(): void {
    this.store.on("position-closed", ({ position }) => this.onClose(position));
    log.info(
      {
        dailyLimitPct: env.DAILY_DRAWDOWN_LIMIT_PCT,
        weeklyLimitPct: env.WEEKLY_DRAWDOWN_LIMIT_PCT,
        consecutiveLossLimit: env.HALT_ON_CONSECUTIVE_LOSSES,
      },
      "drawdown circuit armed",
    );
  }

  stop(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }

  /** Public gate. Called by Trader before opening a position. */
  canTrade(): { allowed: boolean; reason?: string } {
    if (!this.halt) return { allowed: true };
    if (Date.now() >= this.halt.untilTs) {
      this.clearHalt();
      return { allowed: true };
    }
    const remainingMin = Math.max(1, Math.ceil((this.halt.untilTs - Date.now()) / 60_000));
    return {
      allowed: false,
      reason: `circuit HALT (${this.halt.reason}) — ${this.halt.detail}; resumes in ${remainingMin}m`,
    };
  }

  getStats() {
    this.pruneHistory();
    const dailyLossUsd = this.windowLossUsd(DAY_MS);
    const weeklyLossUsd = this.windowLossUsd(WEEK_MS);
    return {
      halted: this.halt !== null,
      haltReason: this.halt?.reason ?? null,
      haltUntilTs: this.halt?.untilTs ?? null,
      haltDetail: this.halt?.detail ?? null,
      consecutiveLosses: this.consecutiveLosses,
      dailyLossUsd,
      weeklyLossUsd,
      closedTracked: this.history.length,
    };
  }

  private onClose(p: Position): void {
    this.history.push({ closedAt: p.closedAt ?? Date.now(), realizedPnlUsd: p.realizedPnlUsd });
    if (p.realizedPnlUsd < 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }
    this.evaluate();
  }

  private evaluate(): void {
    if (this.halt) return; // already halted; canTrade will time it out
    this.pruneHistory();

    const bankroll = this.pnl.buildSnapshot().balanceUsd;
    if (bankroll <= 0) return;

    if (this.consecutiveLosses >= env.HALT_ON_CONSECUTIVE_LOSSES) {
      this.engageHalt({
        reason: "consecutive-losses",
        triggeredAt: Date.now(),
        untilTs: Date.now() + CONSECUTIVE_HALT_MS,
        detail: `${this.consecutiveLosses} consecutive losses (limit ${env.HALT_ON_CONSECUTIVE_LOSSES})`,
      });
      return;
    }

    const dailyLossUsd = this.windowLossUsd(DAY_MS);
    const dailyLossPct = (dailyLossUsd / bankroll) * 100;
    if (dailyLossPct >= env.DAILY_DRAWDOWN_LIMIT_PCT) {
      this.engageHalt({
        reason: "daily-drawdown",
        triggeredAt: Date.now(),
        untilTs: Date.now() + DAILY_HALT_MS,
        detail: `24h loss $${dailyLossUsd.toFixed(2)} = ${dailyLossPct.toFixed(1)}% (limit ${env.DAILY_DRAWDOWN_LIMIT_PCT}%)`,
      });
      return;
    }

    const weeklyLossUsd = this.windowLossUsd(WEEK_MS);
    const weeklyLossPct = (weeklyLossUsd / bankroll) * 100;
    if (weeklyLossPct >= env.WEEKLY_DRAWDOWN_LIMIT_PCT) {
      this.engageHalt({
        reason: "weekly-drawdown",
        triggeredAt: Date.now(),
        untilTs: Date.now() + WEEKLY_HALT_MS,
        detail: `7d loss $${weeklyLossUsd.toFixed(2)} = ${weeklyLossPct.toFixed(1)}% (limit ${env.WEEKLY_DRAWDOWN_LIMIT_PCT}%)`,
      });
    }
  }

  private engageHalt(state: HaltState): void {
    this.halt = state;
    const ms = state.untilTs - Date.now();
    log.fatal({ ...state, haltForMin: Math.round(ms / 60_000) }, "CIRCUIT HALT engaged");
    this.emit("halt-engaged", state);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clearHalt(), ms + 1000).unref();
  }

  private clearHalt(): void {
    if (!this.halt) return;
    log.warn({ reason: this.halt.reason }, "circuit halt cleared");
    this.halt = null;
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.emit("halt-cleared");
  }

  private windowLossUsd(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    let loss = 0;
    for (const r of this.history) {
      if (r.closedAt < cutoff) continue;
      if (r.realizedPnlUsd < 0) loss += -r.realizedPnlUsd;
    }
    return loss;
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - WEEK_MS;
    while (this.history.length > 0 && (this.history[0]?.closedAt ?? 0) < cutoff) {
      this.history.shift();
    }
  }
}

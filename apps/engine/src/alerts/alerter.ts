import type { Position, PositionClosedEvent, PositionOpenedEvent } from "@sniperbot/shared";
import type { HaltState } from "../risk/drawdown-circuit.js";
import { DAY_MS, nextUtcHour, summarize, type ClosedTrade } from "./daily-summary.js";
import * as fmt from "./format.js";
import type { AlertLog, AlertSink } from "./queue.js";

export interface AlertFlags {
  newPosition: boolean;
  exit: boolean;
  drawdownHalt: boolean;
  dailyPnl: boolean;
  engineStatus: boolean;
}

/** The slice of PositionStore the alerter listens to. */
export interface PositionEvents {
  on(event: "position-opened", listener: (e: PositionOpenedEvent) => void): unknown;
  on(event: "position-closed", listener: (e: PositionClosedEvent) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/** The slice of DrawdownCircuit the alerter listens to. */
export interface CircuitEvents {
  on(event: "halt-engaged", listener: (state: HaltState) => void): unknown;
  on(event: "halt-cleared", listener: () => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

export interface BankrollView {
  balanceUsd: number;
  openPositionCount: number;
  openExposureUsd: number;
}

export interface AlerterDeps {
  mode: fmt.Mode;
  flags: AlertFlags;
  dailyHourUtc: number;
  sink: AlertSink;
  store: PositionEvents;
  circuit: CircuitEvents;
  bankroll: () => BankrollView;
  /** Closed positions in [fromTs, toTs). Throwing falls back to memory. */
  loadClosed?: (fromTs: number, toTs: number) => Promise<ClosedTrade[]>;
  log: AlertLog;
  now?: () => number;
}

// Enough for a day of closes at any rate the trader's own limits allow.
const MAX_REMEMBERED_CLOSES = 5000;

/**
 * Turns engine events into Telegram alerts. Owns no delivery logic — that is
 * the sink's job — only what is worth saying and when.
 */
export class Alerter {
  private readonly deps: AlerterDeps;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly recentCloses: ClosedTrade[] = [];
  /** Symbols by mint, so a report built from the database can still name coins. */
  private readonly symbols = new Map<string, string>();
  private dailyTimer: NodeJS.Timeout | null = null;
  private nextReportAt = 0;
  private running = false;

  constructor(deps: AlerterDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
  }

  private readonly onOpened = ({ position }: PositionOpenedEvent) => {
    if (position.tokenSymbol) this.rememberSymbol(position.tokenMint, position.tokenSymbol);
    if (this.deps.flags.newPosition) this.deps.sink.enqueue(fmt.positionOpened(position, this.deps.mode));
  };

  private readonly onClosed = ({ position }: PositionClosedEvent) => {
    this.remember(position);
    if (!this.deps.flags.exit) return;
    const priority = position.closeReason === "rug-pull" ? "critical" : "normal";
    this.deps.sink.enqueue(fmt.positionClosed(position, this.deps.mode), priority);
  };

  private readonly onHalt = (state: HaltState) => {
    if (this.deps.flags.drawdownHalt) this.deps.sink.enqueue(fmt.haltEngaged(state, this.deps.mode), "critical");
  };

  private readonly onHaltCleared = () => {
    if (this.deps.flags.drawdownHalt) this.deps.sink.enqueue(fmt.haltCleared(this.deps.mode));
  };

  /**
   * Subscribe before the drawdown circuit does: the circuit reacts to the same
   * close by halting, and the close should read before the halt it caused.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    const { store, circuit, flags } = this.deps;
    store.on("position-opened", this.onOpened);
    store.on("position-closed", this.onClosed);
    circuit.on("halt-engaged", this.onHalt);
    circuit.on("halt-cleared", this.onHaltCleared);

    if (flags.dailyPnl) {
      this.nextReportAt = nextUtcHour(this.now(), this.deps.dailyHourUtc);
      this.armDailyTimer();
    }
    if (flags.engineStatus) {
      const b = this.deps.bankroll();
      this.deps.sink.enqueue(
        fmt.engineOnline(
          { balanceUsd: b.balanceUsd, openPositionCount: b.openPositionCount, enabled: this.enabledList() },
          this.deps.mode,
        ),
      );
    }
  }

  /** Unsubscribe, say goodbye, and give Telegram a bounded moment to receive it. */
  async stop(signal: string, flushTimeoutMs = 5000): Promise<void> {
    if (!this.running) return;
    this.running = false;
    const { store, circuit, flags } = this.deps;
    store.off("position-opened", this.onOpened);
    store.off("position-closed", this.onClosed);
    circuit.off("halt-engaged", this.onHalt);
    circuit.off("halt-cleared", this.onHaltCleared);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.dailyTimer = null;

    if (flags.engineStatus) {
      const open = this.deps.bankroll().openPositionCount;
      this.deps.sink.enqueue(fmt.engineStopping(signal, open, this.deps.mode), "critical");
    }
    const flushed = await this.deps.sink.flush(flushTimeoutMs);
    if (!flushed) this.deps.log.warn({ timeoutMs: flushTimeoutMs }, "alerts still queued at shutdown were not sent");
  }

  getStats() {
    return this.deps.sink.getStats();
  }

  /**
   * Build and queue the report for the 24h ending at `toTs`. Public so it can
   * be triggered by hand; the daily timer calls it with the scheduled boundary.
   */
  async sendDailySummary(toTs = this.now()): Promise<void> {
    const fromTs = toTs - DAY_MS;
    let trades: ClosedTrade[] | null = null;
    let coverageNote: string | undefined;

    if (this.deps.loadClosed) {
      try {
        trades = (await this.deps.loadClosed(fromTs, toTs)).map((t) => ({
          ...t,
          symbol: t.symbol ?? this.symbols.get(t.mint) ?? null,
        }));
      } catch (err) {
        this.deps.log.warn({ err }, "daily report: database query failed, using in-memory trades");
      }
    }
    if (!trades) {
      trades = this.recentCloses;
      // Say exactly what the numbers cover rather than presenting a partial day as a whole one.
      coverageNote =
        this.startedAt > fromTs
          ? `Database unavailable — covers only trades since the engine started at ${fmt.utcStamp(this.startedAt)}.`
          : "Database unavailable — built from this engine's memory.";
    }

    const summary = summarize(trades, fromTs, toTs);
    const b = this.deps.bankroll();
    this.deps.sink.enqueue(
      fmt.dailySummary(
        summary,
        {
          balanceUsd: b.balanceUsd,
          openPositionCount: b.openPositionCount,
          openExposureUsd: b.openExposureUsd,
          coverageNote,
        },
        this.deps.mode,
      ),
    );
  }

  private armDailyTimer(): void {
    const delay = Math.max(0, this.nextReportAt - this.now());
    this.dailyTimer = setTimeout(() => void this.fireDaily(), delay);
    this.dailyTimer.unref();
  }

  private async fireDaily(): Promise<void> {
    const boundary = this.nextReportAt;
    try {
      await this.sendDailySummary(boundary);
    } catch (err) {
      this.deps.log.error({ err }, "daily report failed");
    }
    if (!this.running) return;
    // Step the fixed schedule forward. A machine that slept through several
    // boundaries gets one report on waking, not one per missed day.
    const now = this.now();
    this.nextReportAt = boundary + DAY_MS;
    while (this.nextReportAt <= now) this.nextReportAt += DAY_MS;
    this.armDailyTimer();
  }

  private remember(p: Position): void {
    if (p.tokenSymbol) this.rememberSymbol(p.tokenMint, p.tokenSymbol);
    this.recentCloses.push({
      mint: p.tokenMint,
      symbol: p.tokenSymbol ?? null,
      realizedPnlUsd: p.realizedPnlUsd,
      entrySizeUsd: p.entrySizeUsd,
      closeReason: p.closeReason ?? null,
      closedAt: p.closedAt ?? this.now(),
    });
    const cutoff = this.now() - DAY_MS;
    while (
      this.recentCloses.length > MAX_REMEMBERED_CLOSES ||
      (this.recentCloses.length > 0 && this.recentCloses[0]!.closedAt < cutoff)
    ) {
      this.recentCloses.shift();
    }
  }

  private rememberSymbol(mint: string, symbol: string): void {
    this.symbols.set(mint, symbol);
    if (this.symbols.size > MAX_REMEMBERED_CLOSES) {
      const oldest = this.symbols.keys().next().value;
      if (oldest !== undefined) this.symbols.delete(oldest);
    }
  }

  private enabledList(): string[] {
    const f = this.deps.flags;
    const out: string[] = [];
    if (f.newPosition) out.push("buys");
    if (f.exit) out.push("exits");
    if (f.drawdownHalt) out.push("halts");
    if (f.dailyPnl) out.push(`daily report ${String(this.deps.dailyHourUtc).padStart(2, "0")}:00 UTC`);
    if (f.engineStatus) out.push("engine status");
    return out;
  }
}

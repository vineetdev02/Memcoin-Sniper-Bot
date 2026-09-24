import type { Position } from "@sniperbot/shared";
import type { AlertLog, AlertQueueStats, AlertSink, Priority } from "./queue.js";

export const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";

export function makePosition(over: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    poolAddress: POOL,
    tokenMint: MINT,
    tokenSymbol: "BONK",
    source: "pumpfun",
    mode: "paper",
    entryPriceUsd: 0.00001234,
    entrySizeUsd: 100,
    remainingTokens: 0,
    initialTokens: 8_000_000,
    currentPriceUsd: 0.00002,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    realizedPnlUsd: 0,
    peakPriceUsd: 0.00003,
    peakGainPct: 143,
    tpLadder: [],
    stopLossPct: -40,
    trailingStopPct: 30,
    trailingStopActivationPct: 200,
    trailingStopArmed: false,
    timeExitMin: 30,
    filterScore: 82,
    openedAt: Date.UTC(2026, 8, 24, 10, 0, 0),
    status: "open",
    ...over,
  };
}

export const silentLog: AlertLog = { info() {}, warn() {}, error() {} };

export function recordingLog() {
  const lines: { level: string; obj: object; msg: string }[] = [];
  const log: AlertLog = {
    info: (obj, msg) => lines.push({ level: "info", obj, msg }),
    warn: (obj, msg) => lines.push({ level: "warn", obj, msg }),
    error: (obj, msg) => lines.push({ level: "error", obj, msg }),
  };
  return { log, lines };
}

/** A sink that records instead of sending. */
export class FakeSink implements AlertSink {
  readonly sent: { text: string; priority: Priority }[] = [];
  flushedWith: number | null = null;
  enqueue(text: string, priority: Priority = "normal"): void {
    this.sent.push({ text, priority });
  }
  async flush(timeoutMs: number): Promise<boolean> {
    this.flushedWith = timeoutMs;
    return true;
  }
  disable(): void {}
  getStats(): AlertQueueStats {
    return { sent: this.sent.length, messages: this.sent.length, failed: 0, dropped: 0, queued: 0, disabled: null };
  }
}

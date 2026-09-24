import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { HaltState } from "../risk/drawdown-circuit.js";
import { Alerter, type AlertFlags, type AlerterDeps } from "./alerter.js";
import { DAY_MS, type ClosedTrade } from "./daily-summary.js";
import { FakeSink, makePosition, silentLog } from "./test-fixtures.js";

const ALL_ON: AlertFlags = { newPosition: true, exit: true, drawdownHalt: true, dailyPnl: false, engineStatus: false };
const NOW = Date.UTC(2026, 8, 24, 12, 0);

function setup(over: Partial<AlerterDeps> = {}) {
  const store = new EventEmitter();
  const circuit = new EventEmitter();
  const sink = new FakeSink();
  const alerter = new Alerter({
    mode: "paper",
    flags: ALL_ON,
    dailyHourUtc: 0,
    sink,
    store,
    circuit,
    bankroll: () => ({ balanceUsd: 10_050, openPositionCount: 2, openExposureUsd: 180 }),
    log: silentLog,
    now: () => NOW,
    ...over,
  });
  return { store, circuit, sink, alerter };
}

const halt: HaltState = {
  reason: "consecutive-losses",
  triggeredAt: NOW,
  untilTs: NOW + DAY_MS,
  detail: "20 consecutive losses (limit 20)",
};

describe("Alerter", () => {
  test("buys, exits and halts become alerts; rugs and halts are critical", () => {
    const { store, circuit, sink, alerter } = setup();
    alerter.start();
    store.emit("position-opened", { type: "position-opened", position: makePosition() });
    store.emit("position-closed", {
      type: "position-closed",
      position: makePosition({ realizedPnlUsd: -95, closeReason: "rug-pull", closedAt: NOW }),
    });
    circuit.emit("halt-engaged", halt);
    circuit.emit("halt-cleared");
    assert.deepEqual(
      sink.sent.map((s) => [s.text.split(" ")[0], s.priority]),
      [["🟢", "normal"], ["🚨", "critical"], ["⛔", "critical"], ["▶️", "normal"]],
    );
  });

  test("each flag turns its alert off", () => {
    const { store, circuit, sink, alerter } = setup({
      flags: { newPosition: false, exit: false, drawdownHalt: false, dailyPnl: false, engineStatus: false },
    });
    alerter.start();
    store.emit("position-opened", { type: "position-opened", position: makePosition() });
    store.emit("position-closed", { type: "position-closed", position: makePosition({ closeReason: "tp1" }) });
    circuit.emit("halt-engaged", halt);
    assert.equal(sink.sent.length, 0);
  });

  test("started before the circuit, a close is reported before the halt it caused", () => {
    const { store, circuit, sink, alerter } = setup();
    alerter.start();
    // What DrawdownCircuit.start() does: react to a close by halting, synchronously.
    store.on("position-closed", () => circuit.emit("halt-engaged", halt));
    store.emit("position-closed", {
      type: "position-closed",
      position: makePosition({ realizedPnlUsd: -40, closeReason: "stop-loss", closedAt: NOW }),
    });
    assert.ok(sink.sent[0]!.text.includes("Sold"));
    assert.ok(sink.sent[1]!.text.includes("Trading halted"));
  });

  test("engine status: online at start, stopping at stop, and listeners are removed", async () => {
    const { store, circuit, sink, alerter } = setup({ flags: { ...ALL_ON, engineStatus: true } });
    alerter.start();
    assert.match(sink.sent[0]!.text, /Engine online · bankroll \$10,050\.00/);
    assert.match(sink.sent[0]!.text, /Alerts: buys, exits, halts, engine status/);
    await alerter.stop("SIGTERM", 1234);
    assert.match(sink.sent[1]!.text, /Engine stopping \(SIGTERM\)\. ⚠️ 2 open positions/);
    assert.equal(sink.sent[1]!.priority, "critical");
    assert.equal(sink.flushedWith, 1234);
    assert.equal(store.listenerCount("position-opened") + store.listenerCount("position-closed"), 0);
    assert.equal(circuit.listenerCount("halt-engaged") + circuit.listenerCount("halt-cleared"), 0);
  });

  test("daily report reads the database and names coins it saw in this process", async () => {
    const rows: ClosedTrade[] = [
      { mint: "MINT_A", realizedPnlUsd: 80, entrySizeUsd: 100, closeReason: "tp3", closedAt: NOW - 1000 },
      { mint: "MINT_B", realizedPnlUsd: -40, entrySizeUsd: 100, closeReason: "stop-loss", closedAt: NOW - 2000 },
    ];
    let asked: [number, number] | null = null;
    const { store, sink, alerter } = setup({
      loadClosed: async (from, to) => {
        asked = [from, to];
        return rows;
      },
    });
    alerter.start();
    store.emit("position-opened", {
      type: "position-opened",
      position: makePosition({ tokenMint: "MINT_A", tokenSymbol: "FROG" }),
    });
    sink.sent.length = 0;
    await alerter.sendDailySummary(NOW);
    assert.deepEqual(asked, [NOW - DAY_MS, NOW]);
    const text = sink.sent[0]!.text;
    assert.match(text, /Closed 2 · 1W \/ 1L · win rate 50\.0%/);
    assert.match(text, /Realized <b>\+\$40\.00<\/b> on \$200\.00 deployed \(\+20\.0%\)/);
    assert.match(text, /Best: FROG \+\$80\.00 · tp3/);
    assert.ok(!text.includes("Database unavailable"));
  });

  test("when the database fails, the report uses memory and says what it covers", async () => {
    const { store, sink, alerter } = setup({
      loadClosed: async () => {
        throw new Error("connection refused");
      },
    });
    alerter.start();
    store.emit("position-closed", {
      type: "position-closed",
      position: makePosition({ realizedPnlUsd: 25, closeReason: "tp1", closedAt: NOW }),
    });
    sink.sent.length = 0;
    await alerter.sendDailySummary(NOW + 1);
    const text = sink.sent[0]!.text;
    assert.match(text, /Closed 1 · 1W \/ 0L/);
    assert.match(text, /Database unavailable — covers only trades since the engine started at 24 Sep 12:00 UTC/);
  });

  test("an empty day still reports, which doubles as a heartbeat", async () => {
    const { sink, alerter } = setup({ loadClosed: async () => [] });
    await alerter.sendDailySummary(NOW);
    assert.match(sink.sent[0]!.text, /No positions closed in this window/);
    assert.match(sink.sent[0]!.text, /Now: 2 open \(\$180\.00 exposure\) · bankroll \$10,050\.00/);
  });
});

/**
 * Deterministic smoke test for DrawdownCircuit.
 * Fires synthetic position-closed events at the store and asserts the
 * circuit halts / unhalts at the right thresholds.
 *
 * Run with:  pnpm --filter @sniperbot/engine exec tsx src/risk/circuit-smoke.ts
 */
import type { Position } from "@sniperbot/shared";
import { PositionStore } from "../state/position-store.js";
import { PnlTracker } from "../analytics/pnl-tracker.js";
import { DrawdownCircuit } from "./drawdown-circuit.js";
import { env } from "../config/env.js";

function fakeClosed(realized: number, id: string): Position {
  return {
    id,
    poolAddress: id,
    tokenMint: id,
    source: "pumpfun",
    mode: "paper",
    entryPriceUsd: 1,
    entrySizeUsd: 100,
    initialTokens: 100,
    remainingTokens: 0,
    currentPriceUsd: 1,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    realizedPnlUsd: realized,
    peakPriceUsd: 1,
    peakGainPct: 0,
    tpLadder: [],
    stopLossPct: -40,
    trailingStopPct: 30,
    trailingStopActivationPct: 200,
    trailingStopArmed: false,
    timeExitMin: 30,
    filterScore: 75,
    openedAt: Date.now() - 60_000,
    closedAt: Date.now(),
    closeReason: realized >= 0 ? "tp1" : "stop-loss",
    status: "closed",
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

async function main() {
  console.log("Env limits:", {
    daily: env.DAILY_DRAWDOWN_LIMIT_PCT,
    weekly: env.WEEKLY_DRAWDOWN_LIMIT_PCT,
    consLossLimit: env.HALT_ON_CONSECUTIVE_LOSSES,
    startingBalance: env.PAPER_STARTING_BALANCE_USD,
  });

  // === Test 1: consecutive losses halt ===
  {
    const store = new PositionStore();
    const pnl = new PnlTracker(store);
    const circuit = new DrawdownCircuit(store, pnl);
    circuit.start();

    assert(circuit.canTrade().allowed, "circuit starts allowing trades");

    for (let i = 0; i < env.HALT_ON_CONSECUTIVE_LOSSES - 1; i++) {
      store.emit("position-closed", { type: "position-closed", position: fakeClosed(-5, `loss-${i}`) });
    }
    assert(circuit.canTrade().allowed, `still allowed after ${env.HALT_ON_CONSECUTIVE_LOSSES - 1} losses`);

    store.emit("position-closed", { type: "position-closed", position: fakeClosed(-5, "loss-final") });
    const gate = circuit.canTrade();
    assert(!gate.allowed, `halts after ${env.HALT_ON_CONSECUTIVE_LOSSES} consecutive losses`);
    assert(/consecutive-losses/.test(gate.reason ?? ""), "halt reason names consecutive-losses");
    circuit.stop();
  }

  // === Test 2: a win clears the consecutive streak ===
  {
    const store = new PositionStore();
    const pnl = new PnlTracker(store);
    const circuit = new DrawdownCircuit(store, pnl);
    circuit.start();

    for (let i = 0; i < env.HALT_ON_CONSECUTIVE_LOSSES - 1; i++) {
      store.emit("position-closed", { type: "position-closed", position: fakeClosed(-5, `loss-${i}`) });
    }
    store.emit("position-closed", { type: "position-closed", position: fakeClosed(10, "win") });
    const stats = circuit.getStats();
    assert(stats.consecutiveLosses === 0, "win resets consecutive losses counter");
    assert(circuit.canTrade().allowed, "no halt after streak broken by a win");
    circuit.stop();
  }

  // === Test 3: daily-drawdown halt ===
  {
    const store = new PositionStore();
    const pnl = new PnlTracker(store);
    const circuit = new DrawdownCircuit(store, pnl);
    circuit.start();

    // Loss = X% of $10k. Need just over DAILY_DRAWDOWN_LIMIT_PCT*100 dollars.
    const lossNeeded = env.PAPER_STARTING_BALANCE_USD * (env.DAILY_DRAWDOWN_LIMIT_PCT / 100) + 5;
    // Spread across multiple positions so consecutive-loss limit doesn't fire first
    const perPosition = lossNeeded / 2;
    // Avoid tripping consecutive-loss limit: interleave with a win after each loss
    store.emit("position-closed", { type: "position-closed", position: fakeClosed(-perPosition, "dd-1") });
    store.emit("position-closed", { type: "position-closed", position: fakeClosed(1, "win-1") });
    store.emit("position-closed", { type: "position-closed", position: fakeClosed(-perPosition, "dd-2") });
    const gate = circuit.canTrade();
    assert(!gate.allowed, `daily-drawdown halt fires at >${env.DAILY_DRAWDOWN_LIMIT_PCT}% (loss $${lossNeeded.toFixed(2)})`);
    assert(/daily-drawdown/.test(gate.reason ?? ""), "halt reason names daily-drawdown");
    circuit.stop();
  }

  console.log("\nALL CIRCUIT TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

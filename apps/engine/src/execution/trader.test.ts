import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { OrchestratorVerdict, PoolEvent } from "@sniperbot/shared";
import { Trader } from "./trader.js";
import type { PositionStore } from "../state/position-store.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";
import type { DrawdownCircuit } from "../risk/drawdown-circuit.js";

const verdict = { decision: "snipe", poolAddress: "P", totalScore: 90 } as OrchestratorVerdict;
const pool = { poolAddress: "P", tokenMint: "MintMintMint" } as PoolEvent;

function makeTrader() {
  const calls = { canTrade: 0, add: 0 };
  // The circuit is the first thing an enabled trader consults; blocking there
  // keeps the test off the paper executor while proving the gate was passed.
  const circuit = {
    canTrade: () => {
      calls.canTrade++;
      return { allowed: false, reason: "test" };
    },
  } as unknown as DrawdownCircuit;
  const store = { add: () => calls.add++, count: () => 0 } as unknown as PositionStore;
  return { trader: new Trader(store, {} as PnlTracker, circuit), calls };
}

describe("trading switch", () => {
  test("a fresh engine opens nothing until trading is started", () => {
    const { trader, calls } = makeTrader();
    assert.equal(trader.isEnabled(), false);
    trader.handleVerdict(verdict, pool);
    assert.deepEqual(calls, { canTrade: 0, add: 0 });
    assert.equal(trader.getStats().skippedDisabled, 1);
  });

  test("once started, a snipe goes on to the risk checks", () => {
    const { trader, calls } = makeTrader();
    trader.setEnabled(true);
    trader.handleVerdict(verdict, pool);
    assert.equal(calls.canTrade, 1);
  });

  test("stopping again blocks the next snipe", () => {
    const { trader, calls } = makeTrader();
    trader.setEnabled(true);
    trader.setEnabled(false);
    trader.handleVerdict(verdict, pool);
    assert.equal(calls.canTrade, 0);
  });
});

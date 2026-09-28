import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { OrchestratorVerdict, PoolEvent, Position } from "@sniperbot/shared";
import { Trader } from "./trader.js";
import type { PositionStore } from "../state/position-store.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";
import type { DrawdownCircuit } from "../risk/drawdown-circuit.js";
import type { MarketFeed, MarketQuote } from "./market-price.js";

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

describe("entries", () => {
  const realRandom = Math.random;
  beforeEach(() => {
    // no simulated failed fill, no simulated sandwich
    Math.random = () => 0.5;
  });
  afterEach(() => {
    Math.random = realRandom;
  });

  function makeLiveTrader(quote: MarketQuote | undefined) {
    const added: { position: Position; profile: unknown }[] = [];
    let quoted = 0;
    const store = {
      count: () => added.length,
      add: (position: Position, profile: unknown) => added.push({ position, profile }),
    } as unknown as PositionStore;
    const pnl = { buildSnapshot: () => ({ openExposureUsd: 0, balanceUsd: 10_000 }) } as unknown as PnlTracker;
    const circuit = { canTrade: () => ({ allowed: true }) } as unknown as DrawdownCircuit;
    const feed = {
      quote: async () => {
        quoted++;
        return quote;
      },
    } as unknown as MarketFeed;
    const trader = new Trader(store, pnl, circuit, feed);
    trader.setEnabled(true);
    return { trader, added, quoted: () => quoted };
  }

  const realPool = { poolAddress: "P", tokenMint: "MintMintMint", initialPriceUsd: 0.000005, initialLiquidityUsd: 5400, detectedAt: 0 } as PoolEvent;

  test("a real pool nobody quotes is not bought, and its rate-limit slot is given back", async () => {
    const { trader, added } = makeLiveTrader(undefined);
    await trader.handleVerdict(verdict, realPool);
    assert.equal(added.length, 0);
    assert.equal(trader.getStats().skippedNoPrice, 1);
    // three more tries still reach the price lookup: nothing was left reserved
    for (let i = 0; i < 3; i++) await trader.handleVerdict(verdict, realPool);
    assert.equal(trader.getStats().skippedRate, 0);
  });

  test("a real pool is bought at its market price, not the parser's estimate", async () => {
    const { trader, added } = makeLiveTrader({ priceUsd: 2, liquidityUsd: 100_000, at: Date.now() });
    await trader.handleVerdict(verdict, realPool);
    assert.equal(added.length, 1);
    const entry = added[0]!.position.entryPriceUsd;
    assert.ok(entry >= 2 && entry < 2.01, `entry ${entry} should be the market price plus slippage`);
    assert.equal(added[0]!.profile, undefined, "a real pool is priced by the feed, not simulated");
  });

  test("a synthetic pool keeps its simulated price and never asks the market", async () => {
    const { trader, added, quoted } = makeLiveTrader(undefined);
    const synthetic = { ...realPool, rawEvent: { synthetic: true, bucket: "SOLID" } } as PoolEvent;
    await trader.handleVerdict(verdict, synthetic);
    assert.equal(quoted(), 0);
    assert.equal(added.length, 1);
    assert.ok(added[0]!.profile, "synthetic positions carry a price profile");
  });
});

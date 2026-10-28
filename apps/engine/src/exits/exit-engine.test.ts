import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Position, Trade } from "@sniperbot/shared";
import { ExitEngine } from "./exit-engine.js";
import { PositionStore } from "../state/position-store.js";
import { MarketFeed, type MarketQuote } from "../execution/market-price.js";

const MIN = 60_000;

function quietStore(): PositionStore {
  const store = new PositionStore();
  const s = store as unknown as Record<string, () => Promise<void>>;
  s.persistOpen = s.persistTrade = s.persistClose = async () => undefined;
  return store;
}

function position(openedAgoMs: number): Position {
  return {
    id: "p1",
    poolAddress: "MINT",
    tokenMint: "MINT",
    source: "pumpfun",
    mode: "paper",
    entryPriceUsd: 1,
    entrySizeUsd: 100,
    initialTokens: 100,
    remainingTokens: 100,
    currentPriceUsd: 1,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    realizedPnlUsd: 0,
    peakPriceUsd: 1,
    peakGainPct: 0,
    tpLadder: [{ gainPct: 50, sellPct: 25, hit: false }],
    stopLossPct: -40,
    trailingStopPct: 30,
    trailingStopActivationPct: 200,
    trailingStopArmed: false,
    timeExitMin: 30,
    filterScore: 90,
    openedAt: Date.now() - openedAgoMs,
    status: "open",
  };
}

/** A real-pool position (no simulated profile) priced by a feed we control. */
function setup(openedAgoMs: number, price: number | null) {
  const store = quietStore();
  const prices = new Map<string, MarketQuote>();
  if (price !== null) prices.set("MINT", { priceUsd: price, liquidityUsd: 50_000, decimals: 6, at: Date.now() });
  const feed = new MarketFeed(() => ["MINT"], async () => prices);
  const engine = new ExitEngine(store, 1, feed);
  store.add(position(openedAgoMs), undefined, {} as Trade);
  const tick = () => (engine as unknown as { tick(): void }).tick();
  return { store, feed, tick };
}

describe("exits on market prices", () => {
  const realRandom = Math.random;
  beforeEach(() => {
    Math.random = () => 0.5;
  });
  afterEach(() => {
    Math.random = realRandom;
  });

  test("the market price drives the stop-loss, not a simulation", async () => {
    const { store, feed, tick } = setup(MIN, 0.5);
    await feed.poll();
    tick();
    assert.equal(store.count(), 0);
    assert.equal(store.recentlyClosed(1)[0]?.closeReason, "stop-loss");
  });

  test("a market move to +50% takes the first profit", async () => {
    const { store, feed, tick } = setup(MIN, 1.6);
    await feed.poll();
    tick();
    const p = store.list()[0];
    assert.equal(p?.status, "partial");
    assert.equal(p?.remainingTokens, 75);
    assert.ok(store.getStats().realizedPnlUsd > 0);
  });

  test("an unpriced position waits inside its window", () => {
    const { store, tick } = setup(MIN, null);
    tick();
    assert.equal(store.count(), 1);
  });

  test("past its window, a token nobody quotes is written off — but not on the first empty tick", () => {
    const { store, tick } = setup(40 * MIN, null);
    tick();
    assert.equal(store.count(), 1, "a restart's first ticks come before the first price");

    const realNow = Date.now;
    Date.now = () => realNow() + 4 * MIN;
    try {
      tick();
    } finally {
      Date.now = realNow;
    }
    assert.equal(store.count(), 0);
    const closed = store.recentlyClosed(1)[0];
    assert.equal(closed?.closeReason, "time-exit");
    assert.ok((closed?.realizedPnlUsd ?? 0) <= -100, "written off at $0");
  });
});

describe("selling up when the engine stops", () => {
  test("a priced position is sold at the market, an unpriced one is left for the next run", async () => {
    const store = quietStore();
    const prices = new Map<string, MarketQuote>([
      ["MINT", { priceUsd: 1.2, liquidityUsd: 50_000, decimals: 6, at: Date.now() }],
    ]);
    const feed = new MarketFeed(() => ["MINT", "DEAD"], async () => prices);
    const engine = new ExitEngine(store, 1, feed);
    store.add(position(MIN), undefined, {} as Trade);
    store.add({ ...position(MIN), id: "p2", poolAddress: "DEAD", tokenMint: "DEAD" }, undefined, {} as Trade);
    await feed.poll();

    assert.deepEqual(engine.sellAllOnShutdown(), { sold: 1, unpriced: 1 });

    assert.deepEqual(store.list().map((p) => p.id), ["p2"]);
    const sold = store.recentlyClosed(1)[0];
    assert.equal(sold?.closeReason, "manual");
    assert.equal(sold?.currentPriceUsd, 1.2, "at the price now, not the last tick's");
    assert.ok((sold?.realizedPnlUsd ?? 0) > 0);
  });

  test("the store's writes can be waited for, so none is cut off by the database closing", async () => {
    const store = new PositionStore();
    const landed: string[] = [];
    const slow = (what: string) => () => new Promise<void>((r) => setTimeout(() => (landed.push(what), r()), 20));
    const s = store as unknown as Record<string, () => Promise<void>>;
    s.persistOpen = slow("open");
    s.persistClose = slow("close");
    s.persistTrade = async () => {
      throw new Error("db down");
    };

    store.add(position(MIN), undefined, {} as Trade);
    store.applyPartialSell("p1", 25, 30, {} as Trade, 0);
    store.closeFully("p1", 90, {} as Trade, "manual");
    await store.flush();

    assert.deepEqual(landed.sort(), ["close", "open"], "a failed write is logged, never awaited forever");
  });
});

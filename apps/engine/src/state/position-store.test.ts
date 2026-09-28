import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Position, Trade } from "@sniperbot/shared";
import { PositionStore } from "./position-store.js";
import type { PriceProfile } from "../execution/price-simulator.js";

function makeStore(): PositionStore {
  const store = new PositionStore();
  // keep the unit off Postgres
  const quiet = store as unknown as Record<string, () => Promise<void>>;
  quiet.persistOpen = quiet.persistTrade = quiet.persistClose = async () => undefined;
  return store;
}

const position = (): Position =>
  ({
    id: "p1",
    poolAddress: "pool",
    tokenMint: "mint",
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
    openedAt: Date.now(),
    status: "open",
  }) as unknown as Position;
const trade = {} as Trade;

describe("realized P&L", () => {
  test("a take-profit shows up in the bankroll as soon as it sells", () => {
    const store = makeStore();
    store.add(position(), {} as PriceProfile, trade);
    // 25 of 100 tokens sold at 1.5x: cost 25, proceeds 37.5
    store.applyPartialSell("p1", 25, 37.5, trade, 0);
    assert.equal(store.getStats().realizedPnlUsd, 12.5);
    assert.equal(store.getStats().totalClosed, 0);
  });

  test("closing adds only the last sale, so the total matches the position", () => {
    const store = makeStore();
    store.add(position(), {} as PriceProfile, trade);
    store.applyPartialSell("p1", 25, 37.5, trade, 0);
    // the other 75 tokens sold at 0.8x: cost 75, proceeds 60 → -15
    const closed = store.closeFully("p1", 60, trade, "stop-loss");
    assert.equal(closed?.realizedPnlUsd, -2.5);
    assert.equal(store.getStats().realizedPnlUsd, -2.5);
    assert.equal(store.getStats().losses, 1);
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Position, Trade } from "@sniperbot/shared";
import { PositionStore } from "./position-store.js";
import { PnlTracker } from "../analytics/pnl-tracker.js";
import { DrawdownCircuit } from "../risk/drawdown-circuit.js";
import { tradingSettings } from "../config/trading-settings.js";
import type { PriceProfile } from "../execution/price-simulator.js";

function makeStore(): PositionStore {
  const store = new PositionStore();
  // keep the unit off Postgres
  const quiet = store as unknown as Record<string, () => Promise<void>>;
  quiet.persistOpen = quiet.persistTrade = quiet.persistClose = async () => undefined;
  return store;
}

const position = (id: string): Position =>
  ({
    id,
    poolAddress: `pool-${id}`,
    tokenMint: `mint-${id}`,
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
    tpLadder: [],
    openedAt: Date.now(),
    status: "open",
  }) as unknown as Position;
const trade = {} as Trade;

describe("a reset leaves the in-memory account fresh", () => {
  test("positions, totals and the bankroll start over at the new amount", () => {
    const store = makeStore();
    const pnl = new PnlTracker(store);
    store.add(position("a"), {} as PriceProfile, trade);
    store.add(position("b"), {} as PriceProfile, trade);
    store.closeFully("a", 15, trade, "stop-loss");

    store.reset();
    pnl.reset(1_000);

    const snap = pnl.buildSnapshot();
    assert.equal(store.count(), 0);
    assert.equal(store.recentlyClosed().length, 0);
    assert.equal(snap.balanceUsd, 1_000);
    assert.equal(snap.startingBalanceUsd, 1_000);
    assert.equal(snap.realizedPnlUsd, 0);
    assert.equal(snap.totalInvestedUsd, 0);
    assert.equal(snap.totalTrades, 0);
  });

  test("a halt from the old account does not block the new one", () => {
    const store = makeStore();
    const pnl = new PnlTracker(store);
    const circuit = new DrawdownCircuit(store, pnl);
    circuit.start();
    const limit = tradingSettings().haltOnConsecutiveLosses;
    for (let i = 0; i < limit; i++) {
      store.add(position(`l${i}`), {} as PriceProfile, trade);
      store.closeFully(`l${i}`, 99, trade, "stop-loss");
    }
    assert.equal(circuit.canTrade().allowed, false);

    circuit.reset();

    assert.equal(circuit.canTrade().allowed, true);
    assert.equal(circuit.getStats().consecutiveLosses, 0);
    assert.equal(circuit.getStats().dailyLossUsd, 0);
    circuit.stop();
  });
});

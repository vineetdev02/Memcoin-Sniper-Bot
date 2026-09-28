import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Position, Trade } from "@sniperbot/shared";
import { RugWatcher } from "./rug-watcher.js";
import { PositionStore } from "../state/position-store.js";
import { MarketFeed, type MarketQuote } from "../execution/market-price.js";
import type { ExitEngine } from "./exit-engine.js";
import type { PriceProfile } from "../execution/price-simulator.js";

function quietStore(): PositionStore {
  const store = new PositionStore();
  const s = store as unknown as Record<string, () => Promise<void>>;
  s.persistOpen = s.persistTrade = s.persistClose = async () => undefined;
  return store;
}

const position = (id: string, mint: string) =>
  ({ id, tokenMint: mint, poolAddress: mint, entryPriceUsd: 1, entrySizeUsd: 100, openedAt: Date.now() }) as Position;

describe("rug watcher on market liquidity", () => {
  test("a liquidity drop past the threshold force-closes; a real pool is watched, a simulated one is not", async () => {
    const store = quietStore();
    store.add(position("real", "REAL"), undefined, {} as Trade);
    store.add(position("sim", "SIM"), { rugAt: null } as PriceProfile, {} as Trade);

    let liq = 10_000;
    const feed = new MarketFeed(
      () => ["REAL", "SIM"],
      async (mints) => new Map(mints.map((m): [string, MarketQuote] => [m, { priceUsd: 1, liquidityUsd: liq, at: 0 }])),
    );
    const closed: string[] = [];
    const exits = { forceClose: (id: string) => closed.push(id) } as unknown as ExitEngine;
    const watcher = new RugWatcher(store, exits, feed);

    await feed.poll();
    watcher.poll(); // first reading is the baseline
    liq = 8_000; // -20%: under the 30% threshold in .env
    await feed.poll();
    watcher.poll();
    assert.deepEqual(closed, []);

    liq = 2_000; // -80%
    await feed.poll();
    watcher.poll();
    assert.deepEqual(closed, ["real"]);
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolEvent } from "@sniperbot/shared";
import { LaunchTape, type LaunchTapeRecord } from "./launch-tape.js";

const MINT = "So11111111111111111111111111111111111111112";
const launch = (o: Partial<PoolEvent> = {}) =>
  ({
    source: "pumpfun",
    tokenMint: MINT,
    creatorWallet: "dev",
    detectedAt: 1_000,
    rawEvent: { name: "Example", symbol: "EX", devBuySol: 1.5 },
    ...o,
  }) as PoolEvent;

function setup() {
  const sent: string[] = [];
  const done: Array<[string, LaunchTapeRecord]> = [];
  const feed = {
    available: true,
    watchTrades: (m: string[]) => sent.push(`+${m.join()}`),
    unwatchTrades: (m: string[]) => sent.push(`-${m.join()}`),
    tradesAvailable: () => feed.available,
  };
  const tape = new LaunchTape(feed, (mint, t) => done.push([mint, t]), 60_000);
  return { tape, sent, done, feed };
}

describe("launch tape", () => {
  test("records each trade with the creator as wallet 0 and others in order of first trade", () => {
    const { tape, sent, done } = setup();
    tape.start(launch());
    tape.record({ mint: MINT, trader: "a", side: "buy", sol: 0.5, receivedAt: 3_000 });
    tape.record({ mint: MINT, trader: "dev", side: "sell", sol: 1.2345, receivedAt: 4_500 });
    tape.record({ mint: MINT, trader: "a", side: "sell", sol: 0.4, receivedAt: 9_000 });
    tape.record({ mint: "other", trader: "b", side: "buy", sol: 9, receivedAt: 9_000 });
    tape.stop();
    assert.deepEqual(sent, [`+${MINT}`, `-${MINT}`]);
    assert.equal(done.length, 1);
    const [mint, t] = done[0]!;
    assert.equal(mint, MINT);
    assert.equal(t.devBuySol, 1.5);
    assert.equal(t.symbol, "EX");
    assert.equal(t.wallets, 2);
    assert.deepEqual(t.trades, [
      [2, 1, 0.5, 1],
      [3.5, -1, 1.235, 0],
      [8, -1, 0.4, 1],
    ]);
  });

  test("with no access to token trades there is no tape at all, rather than an empty one", () => {
    const { tape, done, feed } = setup();
    tape.start(launch());
    // PumpPortal refused the subscription after it was sent
    feed.available = false;
    tape.stop();
    tape.start(launch());
    assert.equal(done.length, 0);
    assert.equal(tape.getStats().recording, 0);
  });

  test("ignores anything that is not a pump.fun launch, and a launch twice", () => {
    const { tape, sent } = setup();
    tape.start(launch({ source: "pumpswap" }));
    tape.start(launch());
    tape.start(launch());
    assert.equal(sent.length, 1);
    assert.equal(tape.getStats().recording, 1);
    tape.stop();
  });
});

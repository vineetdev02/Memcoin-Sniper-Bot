import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MarketFeed, parseQuotes, type MarketQuote } from "./market-price.js";

describe("parseQuotes", () => {
  test("keeps priced mints and leaves out the rest, never pricing a token at zero", () => {
    const q = parseQuotes(
      {
        A: { usdPrice: 0.0000017, liquidity: 3549.2 },
        B: { usdPrice: 0 },
        C: null,
        D: { usdPrice: "1.2" },
        E: { usdPrice: 2 },
      },
      123,
    );
    assert.deepEqual([...q.keys()], ["A", "E"]);
    assert.deepEqual(q.get("A"), { priceUsd: 0.0000017, liquidityUsd: 3549.2, at: 123 });
    assert.equal(q.get("E")?.liquidityUsd, null);
  });

  test("an unexpected body is no prices, not a crash", () => {
    assert.equal(parseQuotes(null, 1).size, 0);
    assert.equal(parseQuotes("nope", 1).size, 0);
  });
});

describe("MarketFeed", () => {
  const quote = (priceUsd: number): MarketQuote => ({ priceUsd, liquidityUsd: 1000, at: Date.now() });

  test("a mint missing from one answer keeps its last price; an untracked one is dropped", async () => {
    let tracked = ["A", "B"];
    let answer = new Map([["A", quote(1)], ["B", quote(2)]]);
    const feed = new MarketFeed(() => tracked, async () => answer);

    await feed.poll();
    assert.equal(feed.get("B")?.priceUsd, 2);

    answer = new Map([["A", quote(1.5)]]);
    await feed.poll();
    assert.equal(feed.get("A")?.priceUsd, 1.5);
    assert.equal(feed.get("B")?.priceUsd, 2, "B was not in the answer, so it keeps its last price");

    tracked = ["A"];
    await feed.poll();
    assert.equal(feed.get("B"), undefined, "B is no longer held, so it is forgotten");
  });

  test("nothing held means no request at all", async () => {
    let calls = 0;
    const feed = new MarketFeed(() => [], async () => {
      calls++;
      return new Map();
    });
    await feed.poll();
    assert.equal(calls, 0);
  });

  test("quote() fetches one mint now and remembers it for the exits", async () => {
    const feed = new MarketFeed(() => [], async (mints) => new Map(mints.map((m) => [m, quote(3)])));
    assert.equal((await feed.quote("Z"))?.priceUsd, 3);
    assert.equal(feed.get("Z")?.priceUsd, 3);
  });
});

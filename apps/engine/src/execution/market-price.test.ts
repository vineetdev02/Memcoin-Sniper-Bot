import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT } from "../feeds/parsers/common.js";
import { MarketFeed, checkEntryPrice, parseQuotes, type MarketQuote } from "./market-price.js";

const q = (priceUsd: number, decimals: number | null = 6): MarketQuote => ({
  priceUsd,
  liquidityUsd: 1000,
  decimals,
  at: Date.now(),
});

describe("parseQuotes", () => {
  test("keeps priced mints and leaves out the rest, never pricing a token at zero", () => {
    const quotes = parseQuotes(
      {
        A: { usdPrice: 0.0000017, liquidity: 3549.2, decimals: 6 },
        B: { usdPrice: 0 },
        C: null,
        D: { usdPrice: "1.2" },
        E: { usdPrice: 2 },
      },
      123,
    );
    assert.deepEqual([...quotes.keys()], ["A", "E"]);
    assert.deepEqual(quotes.get("A"), { priceUsd: 0.0000017, liquidityUsd: 3549.2, decimals: 6, at: 123 });
    assert.equal(quotes.get("E")?.liquidityUsd, null);
    assert.equal(quotes.get("E")?.decimals, null);
  });

  test("an unexpected body is no prices, not a crash", () => {
    assert.equal(parseQuotes(null, 1).size, 0);
    assert.equal(parseQuotes("nope", 1).size, 0);
  });
});

describe("checkEntryPrice", () => {
  // $100 buys 29,000,000 tokens (6 decimals) → $0.00000345 each
  const tokensOutRaw = 29_000_000 * 1e6;

  test("a buy a few percent over the index is the entry price", () => {
    const r = checkEntryPrice({ sizeUsd: 100, index: q(0.00000336), tokensOutRaw });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(Math.abs(r.priceUsd - 100 / 29_000_000) < 1e-15);
      assert.ok(r.premiumPct > 2 && r.premiumPct < 3);
    }
  });

  test("an index 114× above what a real buy pays is refused — the -$99 trade", () => {
    const r = checkEntryPrice({ sizeUsd: 100, index: q(0.000392), tokensOutRaw });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /disagree by -99%/);
  });

  test("a buy that would pay far over the index is refused too", () => {
    assert.equal(checkEntryPrice({ sizeUsd: 100, index: q(0.0000025), tokensOutRaw }).ok, false);
  });

  test("without the token's decimals no price can be computed", () => {
    assert.equal(checkEntryPrice({ sizeUsd: 100, index: q(0.00000336, null), tokensOutRaw }).ok, false);
  });
});

describe("MarketFeed", () => {
  test("a mint missing from one answer keeps its last price; an untracked one is dropped", async () => {
    let tracked = ["A", "B"];
    let answer = new Map([["A", q(1)], ["B", q(2)]]);
    const feed = new MarketFeed(() => tracked, async () => answer);

    await feed.poll();
    assert.equal(feed.get("B")?.priceUsd, 2);

    answer = new Map([["A", q(1.5)]]);
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

  test("a single bad tick is ignored; a jump that repeats is believed", async () => {
    let answer = new Map([["A", q(1)]]);
    const feed = new MarketFeed(() => ["A"], async () => answer);
    await feed.poll();

    answer = new Map([["A", q(0.01)]]); // -99% in one poll
    await feed.poll();
    assert.equal(feed.get("A")?.priceUsd, 1, "held until confirmed");

    answer = new Map([["A", q(1.02)]]); // it was a glitch
    await feed.poll();
    assert.equal(feed.get("A")?.priceUsd, 1.02);

    answer = new Map([["A", q(0.01)]]);
    await feed.poll();
    answer = new Map([["A", q(0.011)]]); // a real collapse: the next poll agrees
    await feed.poll();
    assert.equal(feed.get("A")?.priceUsd, 0.011);
  });

  test("entryQuote sizes the buy in SOL, prices it from the executable quote, and seeds the mark", async () => {
    let lamportsAsked = 0;
    const feed = new MarketFeed(
      () => [],
      async () => new Map([["MINT", q(0.00000336)], [SOL_MINT, q(200, 9)]]),
      3000,
      async (_mint, lamports) => {
        lamportsAsked = lamports;
        return 29_000_000 * 1e6;
      },
    );
    const r = await feed.entryQuote("MINT", 100);
    assert.equal(r.ok, true);
    assert.equal(Math.round(lamportsAsked), 500_000_000, "$100 at $200/SOL is 0.5 SOL");
    assert.equal(feed.get("MINT")?.priceUsd, 0.00000336);
  });

  test("entryQuote refuses when there is no route to buy", async () => {
    const feed = new MarketFeed(
      () => [],
      async () => new Map([["MINT", q(0.00000336)], [SOL_MINT, q(200, 9)]]),
      3000,
      async () => null,
    );
    const r = await feed.entryQuote("MINT", 100);
    assert.deepEqual(r, { ok: false, reason: "no route to buy it" });
    assert.equal(feed.get("MINT"), undefined, "a refused entry does not seed a mark");
  });
});

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolEvent } from "@sniperbot/shared";
import { honeypotSimFilter } from "./honeypot-sim.js";
import { socialSignalFilter } from "./social-signal.js";
import type { FilterContext } from "./types.js";

const ctx = { isSynthetic: false, cfg: { honeypotSimRequired: true, maxSellTaxPct: 5 } } as FilterContext;
const MIN = 60_000;
const pool = (source: PoolEvent["source"], ageMs: number) =>
  ({ source, tokenMint: "TokenMint", detectedAt: Date.now() - ageMs }) as PoolEvent;

/** Jupiter answers, in call order: buy (SOL → token) first, then sell (token → SOL). */
function jupiter(...answers: ({ status: number } | { outAmount: string })[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: URL | string) => {
    calls.push(String(url));
    const a = answers.shift();
    if (!a || "status" in a) return new Response('{"error":"not tradable"}', { status: a && "status" in a ? a.status : 500 });
    return new Response(JSON.stringify({ outAmount: a.outAmount, routePlan: [{}] }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

describe("honeypot-sim", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => jupiter());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a pump.fun curve passes without asking Jupiter: the program executes every sell", async () => {
    const calls = jupiter();
    const r = await honeypotSimFilter.evaluate(pool("pumpfun", 90_000), ctx);
    assert.equal(r.status, "pass");
    assert.equal(calls.length, 0);
  });

  test("an AMM pool is judged by a 0.01 SOL round trip, not by selling one token", async () => {
    const calls = jupiter({ outAmount: "123456789" }, { outAmount: "9900000" }); // back 0.0099 SOL: 1% cost
    const r = await honeypotSimFilter.evaluate(pool("pumpswap", 10 * MIN), ctx);
    assert.equal(r.status, "pass");
    assert.match(r.reason, /round trip costs 1\.0%/);
    assert.match(calls[0] ?? "", /amount=10000000/);
    assert.match(calls[1] ?? "", /amount=123456789/, "sells back exactly what the buy returned");
  });

  test("a round trip that loses more than the max sell tax fails", async () => {
    jupiter({ outAmount: "1000" }, { outAmount: "8800000" }); // 12% gone
    const r = await honeypotSimFilter.evaluate(pool("raydium-amm", 10 * MIN), ctx);
    assert.equal(r.status, "fail");
    assert.match(r.reason, /loses 12\.0%/);
  });

  test("buy route but no sell route is a honeypot — once Jupiter has had time to index it", async () => {
    jupiter({ outAmount: "1000" }, { status: 400 });
    assert.equal((await honeypotSimFilter.evaluate(pool("pumpswap", 10 * MIN), ctx)).status, "fail");
  });

  test("no route in the first minutes is unknown, not a honeypot", async () => {
    jupiter({ status: 400 });
    const r = await honeypotSimFilter.evaluate(pool("pumpswap", 90_000), ctx);
    assert.equal(r.status, "skip");
    assert.match(r.reason, /has not indexed it yet/);
  });

  test("a Jupiter outage is an error, never a verdict on the token", async () => {
    jupiter({ status: 503 });
    assert.equal((await honeypotSimFilter.evaluate(pool("pumpswap", 10 * MIN), ctx)).status, "error");
  });
});

describe("social-signal", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const dexscreener = (pair: object) => {
    globalThis.fetch = (async () => new Response(JSON.stringify([pair]), { status: 200 })) as typeof fetch;
  };

  test("no paid DexScreener profile is unknown, not a fail", async () => {
    dexscreener({ pairAddress: "a", info: {} });
    const r = await socialSignalFilter.evaluate({ tokenMint: "NoProfileMint" } as PoolEvent, ctx);
    assert.equal(r.status, "skip");
  });

  test("a profile with a website and X passes", async () => {
    dexscreener({ pairAddress: "b", info: { websites: [{ url: "https://x.test" }], socials: [{ type: "twitter", url: "https://x.com/t" }] } });
    const r = await socialSignalFilter.evaluate({ tokenMint: "ProfileMint" } as PoolEvent, ctx);
    assert.equal(r.status, "pass");
  });
});

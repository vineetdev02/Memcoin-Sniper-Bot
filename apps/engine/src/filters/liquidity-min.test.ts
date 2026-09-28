import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolEvent } from "@sniperbot/shared";
import { liquidityMinFilter } from "./liquidity-min.js";
import type { FilterContext } from "./types.js";

const ctx = (isSynthetic = false) =>
  ({ isSynthetic, cfg: { liquidityMinUsd: 8000, liquidityMaxUsd: 500_000 } }) as FilterContext;
const pool = (source: PoolEvent["source"], initialLiquidityUsd: number) =>
  ({ source, initialLiquidityUsd }) as PoolEvent;

describe("liquidity-min", () => {
  test("a real pump.fun launch is skipped: its liquidity figure is a constant, not a measurement", async () => {
    const r = await liquidityMinFilter.evaluate(pool("pumpfun", 5400), ctx());
    assert.equal(r.status, "skip");
    assert.match(r.reason, /virtual depth/);
  });

  test("an AMM pool is still held to the threshold", async () => {
    assert.equal((await liquidityMinFilter.evaluate(pool("raydium-amm", 5400), ctx())).status, "fail");
    assert.equal((await liquidityMinFilter.evaluate(pool("pumpswap", 20_000), ctx())).status, "pass");
  });

  test("synthetic pump.fun pools keep their generated liquidity check", async () => {
    assert.equal((await liquidityMinFilter.evaluate(pool("pumpfun", 5400), ctx(true))).status, "fail");
  });
});

describe("lp-locked on a bonding curve", () => {
  test("pump.fun has no LP to pull, so it passes instead of skipping", async () => {
    const { lpLockedFilter } = await import("./lp-locked.js");
    const r = await lpLockedFilter.evaluate(
      { source: "pumpfun" } as PoolEvent,
      { isSynthetic: false, cfg: { lpLockedRequired: true } } as FilterContext,
    );
    assert.equal(r.status, "pass");
    assert.match(r.reason, /no LP exists/);
  });
});

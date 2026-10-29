import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolEvent } from "@sniperbot/shared";
import { curveDemandFilter } from "./curve-demand.js";
import type { FilterContext, SyntheticMock } from "./types.js";

// any valid mint: the curve address is derived from it
const MINT = "So11111111111111111111111111111111111111112";

/** A pump.fun BondingCurve account holding `solIn` real SOL. */
function curveAccount(solIn: number, complete = false): { data: Buffer } {
  const data = Buffer.alloc(49);
  data.writeBigUInt64LE(BigInt(Math.round((30 + solIn) * 1e9)), 16);
  data.writeBigUInt64LE(BigInt(Math.round(solIn * 1e9)), 32);
  data[48] = complete ? 1 : 0;
  return { data };
}

const ctx = (account: { data: Buffer } | null | Error) =>
  ({
    isSynthetic: false,
    cfg: { minCurveSol: 1 },
    conn: {
      getAccountInfo: async () => {
        if (account instanceof Error) throw account;
        return account;
      },
    },
  }) as unknown as FilterContext;
const pool = (source: PoolEvent["source"] = "pumpfun") => ({ source, tokenMint: MINT }) as PoolEvent;

describe("curve-demand", () => {
  test("a curve nobody is holding fails", async () => {
    const r = await curveDemandFilter.evaluate(pool(), ctx(curveAccount(0.0004)));
    assert.equal(r.status, "fail");
    assert.match(r.reason, /only 0\.00 SOL/);
  });

  test("a curve with real buying passes, and records how much", async () => {
    const r = await curveDemandFilter.evaluate(pool(), ctx(curveAccount(8.18)));
    assert.equal(r.status, "pass");
    assert.equal(r.metadata?.solIn, 8.18);
  });

  test("the line is the config's minCurveSol, 1 SOL by default", async () => {
    assert.equal((await curveDemandFilter.evaluate(pool(), ctx(curveAccount(0.99)))).status, "fail");
    assert.equal((await curveDemandFilter.evaluate(pool(), ctx(curveAccount(1)))).status, "pass");
    const strict = { ...ctx(curveAccount(12)), cfg: { minCurveSol: 15 } } as unknown as FilterContext;
    assert.equal((await curveDemandFilter.evaluate(pool(), strict)).status, "fail");
  });

  test("what cannot be read is skipped, never failed", async () => {
    assert.equal((await curveDemandFilter.evaluate(pool(), ctx(null))).status, "skip");
    assert.equal((await curveDemandFilter.evaluate(pool(), ctx(curveAccount(85, true)))).status, "skip");
    assert.equal((await curveDemandFilter.evaluate(pool("pumpswap"), ctx(curveAccount(0)))).status, "skip");
    assert.equal((await curveDemandFilter.evaluate(pool(), ctx(new Error("429")))).status, "error");
  });

  test("synthetic pools use their generated figure, and older ones without it skip", async () => {
    const synthetic = (mock: Partial<SyntheticMock>) =>
      ({ isSynthetic: true, syntheticMock: mock as SyntheticMock, cfg: { minCurveSol: 1 } }) as unknown as FilterContext;
    assert.equal((await curveDemandFilter.evaluate(pool(), synthetic({ curveSolIn: 0.4 }))).status, "fail");
    assert.equal((await curveDemandFilter.evaluate(pool(), synthetic({ curveSolIn: 5 }))).status, "pass");
    assert.equal((await curveDemandFilter.evaluate(pool(), synthetic({}))).status, "skip");
  });
});

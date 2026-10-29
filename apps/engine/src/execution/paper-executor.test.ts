import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PUMPFUN_FEE_PCT, paperExecutor } from "./paper-executor.js";

describe("paper sells", () => {
  test("a pump.fun curve sell pays the venue's fee; anywhere else it does not", () => {
    const other = paperExecutor.sell(1, 2, 100, 1_000_000, "tp1", "raydium-amm");
    const curve = paperExecutor.sell(1, 2, 100, 1_000_000, "tp1", "pumpfun");
    assert.ok(Math.abs(curve.effectivePriceUsd / other.effectivePriceUsd - (1 - PUMPFUN_FEE_PCT / 100)) < 1e-12);
    assert.ok(curve.proceedsUsd < other.proceedsUsd);
  });

  test("without a source nothing extra is taken, as before", () => {
    const a = paperExecutor.sell(1, 2, 100, 1_000_000, "tp1");
    const b = paperExecutor.sell(1, 2, 100, 1_000_000, "tp1", "pumpswap");
    assert.equal(a.effectivePriceUsd, b.effectivePriceUsd);
  });
});

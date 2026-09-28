import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

export const liquidityMinFilter: Filter = {
  id: "liquidity-min",
  weight: 5,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const liq = pool.initialLiquidityUsd;
    const min = ctx.cfg.liquidityMinUsd;
    const max = ctx.cfg.liquidityMaxUsd;

    // The pump.fun parser prices every launch off the same 30 virtual SOL, so
    // this figure is identical for all of them — comparing it to a threshold
    // failed every pump.fun token without measuring anything.
    if (pool.source === "pumpfun" && !ctx.isSynthetic) {
      return makeResult(
        "liquidity-min",
        "skip",
        `bonding curve: $${liq.toFixed(0)} is the same virtual depth for every pump.fun launch, not measured liquidity`,
        { metadata: { liquidityUsd: liq, min, max, virtual: true }, durationMs: Date.now() - start },
      );
    }

    if (liq < min) {
      return makeResult(
        "liquidity-min",
        "fail",
        `Liquidity $${liq.toFixed(0)} below min $${min}`,
        { metadata: { liquidityUsd: liq, min, max }, durationMs: Date.now() - start },
      );
    }
    if (liq > max) {
      return makeResult(
        "liquidity-min",
        "fail",
        `Liquidity $${liq.toFixed(0)} above max $${max} (too late to snipe)`,
        { metadata: { liquidityUsd: liq, min, max }, durationMs: Date.now() - start },
      );
    }

    return makeResult(
      "liquidity-min",
      "pass",
      `$${liq.toFixed(0)} in [$${min} – $${max}]`,
      { metadata: { liquidityUsd: liq, min, max }, durationMs: Date.now() - start },
    );
  },
};

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

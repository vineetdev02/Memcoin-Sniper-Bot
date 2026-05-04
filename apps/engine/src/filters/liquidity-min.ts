import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { env } from "../config/env.js";

export const liquidityMinFilter: Filter = {
  id: "liquidity-min",
  weight: 5,
  enabled: true,
  async evaluate(pool) {
    const start = Date.now();
    const liq = pool.initialLiquidityUsd;
    const min = env.FILTER_LIQUIDITY_MIN_USD;
    const max = env.FILTER_LIQUIDITY_MAX_USD;

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

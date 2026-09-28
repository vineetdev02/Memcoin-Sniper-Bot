import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { fetchPair } from "../feeds/dexscreener-client.js";

const MIN_AGE_MS = 60_000; // need ~1 min of trades before we can judge velocity
const MIN_BUYS_M5 = 5;
const MIN_BUY_SELL_RATIO = 1.2;

export const volumeVelocityFilter: Filter = {
  id: "volume-velocity",
  weight: 4,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const ratio = ctx.syntheticMock.buySellRatio;
      const ok = ratio >= MIN_BUY_SELL_RATIO;
      return makeResult(
        "volume-velocity",
        ok ? "pass" : "fail",
        `buy/sell ratio ${ratio.toFixed(2)}`,
        { metadata: { buySellRatio: ratio }, durationMs: Date.now() - start },
      );
    }

    const ageMs = Date.now() - pool.detectedAt;
    if (ageMs < MIN_AGE_MS) {
      return makeResult(
        "volume-velocity",
        "skip",
        `pool too young (${Math.round(ageMs / 1000)}s) — need ${MIN_AGE_MS / 1000}s of history`,
        { durationMs: Date.now() - start },
      );
    }

    const pair = await fetchPair(pool.tokenMint);
    if (!pair) {
      return makeResult("volume-velocity", "skip", "DexScreener has no pair data yet", {
        durationMs: Date.now() - start,
      });
    }

    const buys = pair.txns?.m5?.buys ?? 0;
    const sells = pair.txns?.m5?.sells ?? 0;
    const ratio = sells === 0 ? (buys > 0 ? Infinity : 0) : buys / sells;

    if (buys < MIN_BUYS_M5) {
      return makeResult(
        "volume-velocity",
        "fail",
        `only ${buys} buys in last 5m — no organic interest`,
        { metadata: { buys, sells }, durationMs: Date.now() - start },
      );
    }

    const ok = ratio >= MIN_BUY_SELL_RATIO;
    return makeResult(
      "volume-velocity",
      ok ? "pass" : "fail",
      ok
        ? `${buys}b / ${sells}s in 5m — ratio ${isFinite(ratio) ? ratio.toFixed(2) : "inf"}`
        : `${buys}b / ${sells}s in 5m — ratio ${ratio.toFixed(2)} < ${MIN_BUY_SELL_RATIO}`,
      {
        metadata: { buys, sells, ratio: isFinite(ratio) ? ratio : null, volumeM5: pair.volume?.m5 ?? 0 },
        durationMs: Date.now() - start,
      },
    );
  },
};

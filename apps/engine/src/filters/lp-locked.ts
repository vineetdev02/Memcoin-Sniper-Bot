import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

const KNOWN_LOCKERS = new Set([
  "GThUX1Atko4tqhN2NaiTazWSeFWMuiUiswQrAjfb56XV", // Streamflow lock
  "DQYrAcCrUXUTpb1B5SQa3jgbtBGfSJpKL2BXwJDM4kky", // Solana Lock variant
]);

const BURN_ADDR = "11111111111111111111111111111111";

export const lpLockedFilter: Filter = {
  id: "lp-locked",
  weight: 10,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (!ctx.cfg.lpLockedRequired) {
      return makeResult("lp-locked", "skip", "filter disabled", {
        durationMs: Date.now() - start,
      });
    }

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const status = ctx.syntheticMock.lpStatus;
      const safe = status === "burned" || status === "locked";
      return makeResult(
        "lp-locked",
        safe ? "pass" : "fail",
        status === "burned"
          ? "LP burned to dead address"
          : status === "locked"
            ? "LP locked in known locker"
            : "LP still in dev wallet (rug risk)",
        { metadata: { status }, durationMs: Date.now() - start },
      );
    }

    // A pump.fun bonding curve has no LP token to pull: the SOL sits in the
    // curve and only the pump.fun program can move it (on buys, sells and
    // migration). The risk this filter guards against cannot happen there.
    if (pool.source === "pumpfun") {
      return makeResult(
        "lp-locked",
        "pass",
        "bonding curve — no LP exists; liquidity is held by the pump.fun program",
        { metadata: { status: "bonding-curve" }, durationMs: Date.now() - start },
      );
    }

    // Real-mode lookup is non-trivial — Raydium needs decoding the AMM account
    // to find the LP mint then the largest LP holder. For Phase 2 we mark this
    // as skip in real mode and add proper IDL-aware decoding in Phase 4.
    return makeResult(
      "lp-locked",
      "skip",
      "real-mode LP detection deferred to IDL-aware decoding (Phase 4)",
      { metadata: { knownLockers: KNOWN_LOCKERS.size, burnAddr: BURN_ADDR }, durationMs: Date.now() - start },
    );
  },
};

import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

export const bundledLaunchFilter: Filter = {
  id: "bundled-launch",
  weight: 8,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (!ctx.cfg.bundledLaunchReject) {
      return makeResult("bundled-launch", "skip", "filter disabled", {
        durationMs: Date.now() - start,
      });
    }
    if (ctx.isSynthetic && ctx.syntheticMock) {
      const bundled = ctx.syntheticMock.bundledLaunch;
      return makeResult(
        "bundled-launch",
        bundled ? "fail" : "pass",
        bundled ? "first block dominated by sybil wallets" : "no bundled buy pattern",
        { durationMs: Date.now() - start },
      );
    }
    return makeResult(
      "bundled-launch",
      "skip",
      "real-mode bundle detection requires fetching first-block txs (Phase 4)",
      { durationMs: Date.now() - start },
    );
  },
};

export const insiderDetectionFilter: Filter = {
  id: "insider-detection",
  weight: 6,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (ctx.isSynthetic && ctx.syntheticMock) {
      const insider = ctx.syntheticMock.insiderFunded;
      return makeResult(
        "insider-detection",
        insider ? "fail" : "pass",
        insider ? "creator funded by known insider wallet" : "no insider funding chain",
        { durationMs: Date.now() - start },
      );
    }
    return makeResult(
      "insider-detection",
      "skip",
      "real-mode insider tracing needs Bitquery (Phase 4)",
      { durationMs: Date.now() - start },
    );
  },
};

export const socialSignalFilter: Filter = {
  id: "social-signal",
  weight: 3,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (ctx.isSynthetic && ctx.syntheticMock) {
      const score = ctx.syntheticMock.socialScore;
      const ok = score >= 30;
      return makeResult(
        "social-signal",
        ok ? "pass" : "fail",
        `social score ${score}/100`,
        { score, metadata: { socialScore: score }, durationMs: Date.now() - start },
      );
    }
    return makeResult(
      "social-signal",
      "skip",
      "real-mode social fetch deferred (DexScreener boosts integration in Phase 4)",
      { durationMs: Date.now() - start },
    );
  },
};

export const volumeVelocityFilter: Filter = {
  id: "volume-velocity",
  weight: 4,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (ctx.isSynthetic && ctx.syntheticMock) {
      const ratio = ctx.syntheticMock.buySellRatio;
      const ok = ratio >= 1.2;
      return makeResult(
        "volume-velocity",
        ok ? "pass" : "fail",
        `buy/sell ratio ${ratio.toFixed(2)}`,
        { metadata: { buySellRatio: ratio }, durationMs: Date.now() - start },
      );
    }
    return makeResult(
      "volume-velocity",
      "skip",
      "real-mode velocity needs short post-detection window (Phase 4)",
      { durationMs: Date.now() - start },
    );
  },
};

export const antiSniperWarFilter: Filter = {
  id: "anti-sniper-war",
  weight: 4,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const earlyTxLimit = 10;
    if (ctx.isSynthetic && ctx.syntheticMock) {
      const count = ctx.syntheticMock.earlyTxCount;
      const ok = count <= earlyTxLimit;
      return makeResult(
        "anti-sniper-war",
        ok ? "pass" : "fail",
        ok
          ? `${count} early txs — safe entry`
          : `${count} early txs — already pumping, snipers in`,
        { metadata: { earlyTxCount: count, limit: earlyTxLimit }, durationMs: Date.now() - start },
      );
    }
    return makeResult(
      "anti-sniper-war",
      "skip",
      "real-mode requires fetching first-block tx count (Phase 4)",
      { durationMs: Date.now() - start },
    );
  },
};

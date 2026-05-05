import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { env } from "../config/env.js";
import { getPrisma } from "../state/db.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("filter:dev-wallet");
const cache = new Map<string, { rugRate: number; cachedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

async function fetchRugCheckScore(wallet: string): Promise<number | null> {
  try {
    const url = `${env.RUGCHECK_API_BASE}/wallets/${wallet}/report`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.json()) as { rugRate?: number; rugCount?: number; totalLaunches?: number };
    if (typeof body.rugRate === "number") return body.rugRate;
    if (body.rugCount && body.totalLaunches) return body.rugCount / body.totalLaunches;
    return null;
  } catch {
    return null;
  }
}

export const devWalletFilter: Filter = {
  id: "dev-wallet",
  weight: 12,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const max = ctx.cfg.devRugRateMax;

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const rate = ctx.syntheticMock.devRugRate;
      const launches = ctx.syntheticMock.devLaunchCount;
      const fail = rate > max;
      return makeResult(
        "dev-wallet",
        fail ? "fail" : "pass",
        fail
          ? `dev rug rate ${(rate * 100).toFixed(0)}% > max ${(max * 100).toFixed(0)}% (${launches} launches)`
          : `dev clean: ${(rate * 100).toFixed(0)}% rug rate over ${launches} launches`,
        { metadata: { rugRate: rate, devLaunchCount: launches, max }, durationMs: Date.now() - start },
      );
    }

    const wallet = pool.creatorWallet;

    // 1. Check local DB
    try {
      const prisma = getPrisma();
      const known = await prisma.ruggedDevWallet.findUnique({ where: { walletAddress: wallet } });
      if (known) {
        const fail = known.rugRate > max;
        return makeResult(
          "dev-wallet",
          fail ? "fail" : "pass",
          `local db: ${(known.rugRate * 100).toFixed(0)}% rug rate over ${known.totalLaunches} launches`,
          {
            metadata: { source: "local-db", rugRate: known.rugRate, launches: known.totalLaunches },
            durationMs: Date.now() - start,
          },
        );
      }
    } catch (err) {
      log.warn({ err, wallet }, "local rugger lookup failed");
    }

    // 2. Check in-process cache
    const cached = cache.get(wallet);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      const fail = cached.rugRate > max;
      return makeResult(
        "dev-wallet",
        fail ? "fail" : "pass",
        `cached: ${(cached.rugRate * 100).toFixed(0)}% rug rate`,
        { metadata: { source: "cache", rugRate: cached.rugRate }, durationMs: Date.now() - start },
      );
    }

    // 3. Hit RugCheck.xyz
    const rate = await fetchRugCheckScore(wallet);
    if (rate === null) {
      // Unknown wallet — treat as neutral pass with low confidence
      return makeResult("dev-wallet", "pass", "unknown wallet (no history)", {
        score: 50,
        metadata: { source: "unknown" },
        durationMs: Date.now() - start,
      });
    }

    cache.set(wallet, { rugRate: rate, cachedAt: Date.now() });
    const fail = rate > max;
    return makeResult(
      "dev-wallet",
      fail ? "fail" : "pass",
      fail
        ? `RugCheck: dev rugged ${(rate * 100).toFixed(0)}% of past launches`
        : `RugCheck: dev clean (${(rate * 100).toFixed(0)}% rug rate)`,
      { metadata: { source: "rugcheck", rugRate: rate }, durationMs: Date.now() - start },
    );
  },
};

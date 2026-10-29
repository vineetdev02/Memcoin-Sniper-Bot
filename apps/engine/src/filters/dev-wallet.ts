import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { env } from "../config/env.js";
import { getPrisma } from "../state/db.js";
import type { DexSource as DbDexSource } from "@prisma/client";
import { dexSourceToPrisma } from "../feeds/pool-detector.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("filter:dev-wallet");
const cache = new Map<string, { rugRate: number; cachedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A wallet that launched `max` coins or more in the last day is a launch farm.
 * Of 592 shadow-tracked pump.fun launches by creators with 3+ earlier
 * launches, none graduated, and buying them lost $6-7 a trade against $2-3
 * for a first launch, in both halves of the night. Null: not a farm, or off.
 */
export function launchFarmReason(launches24h: number, max: number): string | null {
  if (max <= 0 || launches24h < max) return null;
  return `launched ${launches24h} other coins in the last 24 h (max ${max - 1}): a launch farm`;
}

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

    // 0. Launch farms, from the pools this bot has seen. Every launch is
    // recorded, so this needs no outside service and is never "unknown".
    let launches24h: number | null = null;
    if (ctx.cfg.devMaxLaunches24h > 0 && wallet) {
      try {
        launches24h = await getPrisma().pool.count({
          where: {
            creatorWallet: wallet,
            source: dexSourceToPrisma[pool.source] as DbDexSource,
            tokenMint: { not: pool.tokenMint },
            detectedAt: { gte: new Date(pool.detectedAt - DAY_MS), lt: new Date(pool.detectedAt) },
          },
        });
        const farm = launchFarmReason(launches24h, ctx.cfg.devMaxLaunches24h);
        if (farm) {
          return makeResult("dev-wallet", "fail", farm, {
            metadata: { source: "launch-history", launches24h, max: ctx.cfg.devMaxLaunches24h },
            durationMs: Date.now() - start,
          });
        }
      } catch (err) {
        log.warn({ err, wallet }, "launch history lookup failed");
      }
    }

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
        metadata: { source: "unknown", launches24h },
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

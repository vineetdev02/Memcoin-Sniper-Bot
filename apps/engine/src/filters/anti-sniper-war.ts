import { PublicKey } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

const EARLY_TX_LIMIT = 10;
const SIGNATURE_FETCH_LIMIT = 25;
const EARLY_WINDOW_SEC = 6; // count txs in the first ~6 seconds after pool creation
const cache = new Map<string, { count: number; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

export const antiSniperWarFilter: Filter = {
  id: "anti-sniper-war",
  weight: 4,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const count = ctx.syntheticMock.earlyTxCount;
      const ok = count <= EARLY_TX_LIMIT;
      return makeResult(
        "anti-sniper-war",
        ok ? "pass" : "fail",
        ok
          ? `${count} early txs — safe entry`
          : `${count} early txs — already pumping, snipers in`,
        {
          metadata: { earlyTxCount: count, limit: EARLY_TX_LIMIT },
          durationMs: Date.now() - start,
        },
      );
    }

    const cached = cache.get(pool.poolAddress);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const ok = cached.count <= EARLY_TX_LIMIT;
      return makeResult(
        "anti-sniper-war",
        ok ? "pass" : "fail",
        `${cached.count} early txs (cached)`,
        {
          metadata: { earlyTxCount: cached.count, limit: EARLY_TX_LIMIT, source: "cache" },
          durationMs: Date.now() - start,
        },
      );
    }

    try {
      const sigs = await ctx.conn.getSignaturesForAddress(new PublicKey(pool.poolAddress), {
        limit: SIGNATURE_FETCH_LIMIT,
      });
      if (sigs.length === 0) {
        return makeResult("anti-sniper-war", "skip", "no signatures yet for pool", {
          durationMs: Date.now() - start,
        });
      }
      const oldest = sigs[sigs.length - 1];
      const baseTime = oldest?.blockTime ?? Math.floor(pool.detectedAt / 1000);
      const cutoff = baseTime + EARLY_WINDOW_SEC;
      const earlyCount = sigs.filter(
        (s) => s.blockTime !== null && s.blockTime !== undefined && s.blockTime <= cutoff,
      ).length;
      cache.set(pool.poolAddress, { count: earlyCount, cachedAt: Date.now() });

      const ok = earlyCount <= EARLY_TX_LIMIT;
      return makeResult(
        "anti-sniper-war",
        ok ? "pass" : "fail",
        ok
          ? `${earlyCount} txs in first ${EARLY_WINDOW_SEC}s — clean entry`
          : `${earlyCount} txs in first ${EARLY_WINDOW_SEC}s — sniper pile-on`,
        {
          metadata: {
            earlyTxCount: earlyCount,
            limit: EARLY_TX_LIMIT,
            windowSec: EARLY_WINDOW_SEC,
            totalSigsFetched: sigs.length,
          },
          durationMs: Date.now() - start,
        },
      );
    } catch (err) {
      return makeResult(
        "anti-sniper-war",
        "error",
        `RPC error: ${(err as Error).message}`,
        { durationMs: Date.now() - start },
      );
    }
  },
};

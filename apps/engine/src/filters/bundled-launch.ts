import { PublicKey } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { fetchParsedTx, getFeePayer } from "../feeds/parsers/common.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("filter:bundled-launch");

const SIG_FETCH_LIMIT = 20;
const EARLY_WINDOW_SEC = 4;
const SAMPLE_TX_LIMIT = 8; // cap parsed-tx fetches per evaluation (RPC cost)
const SINGLE_PAYER_DOMINANCE = 0.5; // fail if one non-creator wallet > 50% of early sample
const cache = new Map<string, { bundled: boolean; reason: string; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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

    const cached = cache.get(pool.poolAddress);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return makeResult(
        "bundled-launch",
        cached.bundled ? "fail" : "pass",
        `${cached.reason} (cached)`,
        { durationMs: Date.now() - start },
      );
    }

    try {
      const sigs = await ctx.conn.getSignaturesForAddress(new PublicKey(pool.poolAddress), {
        limit: SIG_FETCH_LIMIT,
      });
      if (sigs.length === 0) {
        return makeResult("bundled-launch", "skip", "no signatures yet for pool", {
          durationMs: Date.now() - start,
        });
      }

      const ordered = [...sigs].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
      const oldestTime = ordered[0]?.blockTime ?? Math.floor(pool.detectedAt / 1000);
      const cutoff = oldestTime + EARLY_WINDOW_SEC;
      const earlySigs = ordered.filter(
        (s) => s.blockTime !== null && s.blockTime !== undefined && s.blockTime <= cutoff,
      );

      const sample = earlySigs.slice(0, SAMPLE_TX_LIMIT);
      const payers: string[] = [];
      for (const s of sample) {
        const tx = await fetchParsedTx(ctx.conn, s.signature, 1);
        if (!tx) continue;
        const fp = getFeePayer(tx);
        if (fp) payers.push(fp);
      }

      if (payers.length < 3) {
        const reason = `only ${payers.length} early payer(s) — insufficient sample`;
        cache.set(pool.poolAddress, { bundled: false, reason, cachedAt: Date.now() });
        return makeResult("bundled-launch", "skip", reason, {
          metadata: { payersSampled: payers.length },
          durationMs: Date.now() - start,
        });
      }

      const nonCreator = payers.filter((p) => p !== pool.creatorWallet);
      const counts = new Map<string, number>();
      for (const p of nonCreator) counts.set(p, (counts.get(p) ?? 0) + 1);
      let topPayer = "";
      let topCount = 0;
      for (const [p, c] of counts) {
        if (c > topCount) {
          topPayer = p;
          topCount = c;
        }
      }
      const dominance = nonCreator.length > 0 ? topCount / nonCreator.length : 0;
      const bundled = dominance >= SINGLE_PAYER_DOMINANCE;
      const reason = bundled
        ? `${topPayer.slice(0, 8)}… controls ${(dominance * 100).toFixed(0)}% of early non-creator txs`
        : `${counts.size} unique early buyers — distributed`;

      cache.set(pool.poolAddress, { bundled, reason, cachedAt: Date.now() });

      return makeResult(
        "bundled-launch",
        bundled ? "fail" : "pass",
        reason,
        {
          metadata: {
            payersSampled: payers.length,
            uniqueNonCreatorPayers: counts.size,
            topPayerSharePct: Math.round(dominance * 100),
            windowSec: EARLY_WINDOW_SEC,
          },
          durationMs: Date.now() - start,
        },
      );
    } catch (err) {
      log.warn({ err: (err as Error).message, pool: pool.poolAddress }, "bundled check failed");
      return makeResult(
        "bundled-launch",
        "error",
        `RPC error: ${(err as Error).message}`,
        { durationMs: Date.now() - start },
      );
    }
  },
};

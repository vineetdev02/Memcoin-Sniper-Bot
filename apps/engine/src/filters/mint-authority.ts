import { PublicKey } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

export const mintAuthorityFilter: Filter = {
  id: "mint-authority",
  weight: 10,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (!ctx.cfg.mintAuthRenounced) {
      return makeResult("mint-authority", "skip", "filter disabled", {
        durationMs: Date.now() - start,
      });
    }

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const ok = ctx.syntheticMock.mintAuthRenounced;
      return makeResult(
        "mint-authority",
        ok ? "pass" : "fail",
        ok ? "mint authority renounced" : "dev still has mint authority",
        { durationMs: Date.now() - start },
      );
    }

    try {
      const mintInfo = await ctx.conn.getParsedAccountInfo(new PublicKey(pool.tokenMint));
      const data = mintInfo.value?.data;
      if (!data || typeof data !== "object" || !("parsed" in data)) {
        return makeResult("mint-authority", "skip", "could not parse mint account", {
          durationMs: Date.now() - start,
        });
      }
      const parsed = (data as { parsed: { info?: { mintAuthority?: string | null } } }).parsed;
      const authority = parsed.info?.mintAuthority ?? null;
      const renounced = authority === null;
      return makeResult(
        "mint-authority",
        renounced ? "pass" : "fail",
        renounced ? "mint authority renounced" : `mint authority still set (${authority?.slice(0, 8)}…)`,
        {
          metadata: { mintAuthority: authority },
          durationMs: Date.now() - start,
        },
      );
    } catch (err) {
      return makeResult(
        "mint-authority",
        "error",
        `RPC error: ${(err as Error).message}`,
        { durationMs: Date.now() - start },
      );
    }
  },
};

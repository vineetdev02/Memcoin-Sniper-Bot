import { PublicKey } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

export const freezeAuthorityFilter: Filter = {
  id: "freeze-authority",
  weight: 10,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (!ctx.cfg.freezeAuthRenounced) {
      return makeResult("freeze-authority", "skip", "filter disabled", {
        durationMs: Date.now() - start,
      });
    }

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const ok = ctx.syntheticMock.freezeAuthRenounced;
      return makeResult(
        "freeze-authority",
        ok ? "pass" : "fail",
        ok ? "freeze authority renounced" : "dev can freeze your wallet",
        { durationMs: Date.now() - start },
      );
    }

    try {
      const mintInfo = await ctx.conn.getParsedAccountInfo(new PublicKey(pool.tokenMint));
      const data = mintInfo.value?.data;
      if (!data || typeof data !== "object" || !("parsed" in data)) {
        return makeResult("freeze-authority", "skip", "could not parse mint", {
          durationMs: Date.now() - start,
        });
      }
      const parsed = (data as { parsed: { info?: { freezeAuthority?: string | null } } }).parsed;
      const authority = parsed.info?.freezeAuthority ?? null;
      const renounced = authority === null;
      return makeResult(
        "freeze-authority",
        renounced ? "pass" : "fail",
        renounced
          ? "freeze authority renounced"
          : `freeze authority set (${authority?.slice(0, 8)}…) — dev can freeze your wallet`,
        {
          metadata: { freezeAuthority: authority },
          durationMs: Date.now() - start,
        },
      );
    } catch (err) {
      return makeResult(
        "freeze-authority",
        "error",
        `RPC error: ${(err as Error).message}`,
        { durationMs: Date.now() - start },
      );
    }
  },
};

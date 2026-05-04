import { PublicKey } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { env } from "../config/env.js";

export const topHoldersFilter: Filter = {
  id: "top-holders",
  weight: 8,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const max1 = env.FILTER_TOP_HOLDER_MAX_PCT;
    const max10 = env.FILTER_TOP_10_HOLDERS_MAX_PCT;

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const top1 = ctx.syntheticMock.topHolderPct;
      const top10 = ctx.syntheticMock.top10HoldersPct;
      const fail1 = top1 > max1;
      const fail10 = top10 > max10;
      const failed = fail1 || fail10;
      const reason = failed
        ? `top1 ${top1.toFixed(1)}% (max ${max1}%) · top10 ${top10.toFixed(1)}% (max ${max10}%)`
        : `top1 ${top1.toFixed(1)}% · top10 ${top10.toFixed(1)}% — distributed`;
      return makeResult("top-holders", failed ? "fail" : "pass", reason, {
        metadata: { top1, top10, max1, max10 },
        durationMs: Date.now() - start,
      });
    }

    try {
      const result = await ctx.conn.getTokenLargestAccounts(new PublicKey(pool.tokenMint));
      const accounts = result.value;
      if (accounts.length === 0) {
        return makeResult("top-holders", "skip", "no holders yet", {
          durationMs: Date.now() - start,
        });
      }
      const supply = await ctx.conn.getTokenSupply(new PublicKey(pool.tokenMint));
      const totalAmount = Number(supply.value.amount);
      if (totalAmount === 0) {
        return makeResult("top-holders", "skip", "supply unavailable", {
          durationMs: Date.now() - start,
        });
      }

      const top1 = (Number(accounts[0]?.amount ?? 0) / totalAmount) * 100;
      const top10 =
        (accounts.slice(0, 10).reduce((s, a) => s + Number(a.amount), 0) / totalAmount) * 100;

      const fail = top1 > max1 || top10 > max10;
      return makeResult(
        "top-holders",
        fail ? "fail" : "pass",
        fail
          ? `top1 ${top1.toFixed(1)}% / top10 ${top10.toFixed(1)}% — too concentrated`
          : `top1 ${top1.toFixed(1)}% / top10 ${top10.toFixed(1)}%`,
        {
          metadata: { top1, top10, max1, max10, accountCount: accounts.length },
          durationMs: Date.now() - start,
        },
      );
    } catch (err) {
      return makeResult(
        "top-holders",
        "error",
        `RPC error: ${(err as Error).message}`,
        { durationMs: Date.now() - start },
      );
    }
  },
};

import { PublicKey, type AccountInfo, type ParsedAccountData } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";

function ownerOf(info: AccountInfo<Buffer | ParsedAccountData> | null | undefined): string | null {
  const data = info?.data;
  if (!data || Buffer.isBuffer(data)) return null;
  const owner = (data.parsed as { info?: { owner?: unknown } } | undefined)?.info?.owner;
  return typeof owner === "string" ? owner : null;
}

export const topHoldersFilter: Filter = {
  id: "top-holders",
  weight: 8,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const max1 = ctx.cfg.topHolderMaxPct;
    const max10 = ctx.cfg.top10HoldersMaxPct;

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
      const mint = new PublicKey(pool.tokenMint);
      const result = await ctx.conn.getTokenLargestAccounts(mint);
      const accounts = result.value;
      if (accounts.length === 0) {
        return makeResult("top-holders", "skip", "no holders yet", {
          durationMs: Date.now() - start,
        });
      }
      const supply = await ctx.conn.getTokenSupply(mint);
      const totalAmount = Number(supply.value.amount);
      if (totalAmount === 0) {
        return makeResult("top-holders", "skip", "supply unavailable", {
          durationMs: Date.now() - start,
        });
      }

      // A bonding curve, AMM vault or locker holds tokens for a program, not a
      // person — and at launch the curve holds nearly all of them, which made
      // every new token read as "100% concentrated". Such accounts are owned by
      // a program-derived address, which is never on the ed25519 curve.
      const infos = await ctx.conn.getMultipleParsedAccounts(accounts.map((a) => a.address));
      const wallets: typeof accounts = [];
      let programHeld = 0;
      accounts.forEach((a, i) => {
        const owner = ownerOf(infos.value[i]);
        // an owner we could not read counts as a wallet: never under-report a whale
        if (owner && !PublicKey.isOnCurve(owner)) programHeld += Number(a.amount);
        else wallets.push(a);
      });

      const pct = (amount: number) => (amount / totalAmount) * 100;
      const top1 = pct(Number(wallets[0]?.amount ?? 0));
      const top10 = pct(wallets.slice(0, 10).reduce((s, a) => s + Number(a.amount), 0));
      const programHeldPct = pct(programHeld);
      const note = programHeld > 0 ? ` (pool/curve accounts holding ${programHeldPct.toFixed(1)}% excluded)` : "";

      const fail = top1 > max1 || top10 > max10;
      return makeResult(
        "top-holders",
        fail ? "fail" : "pass",
        fail
          ? `top1 ${top1.toFixed(1)}% / top10 ${top10.toFixed(1)}% — too concentrated${note}`
          : `top1 ${top1.toFixed(1)}% / top10 ${top10.toFixed(1)}%${note}`,
        {
          metadata: {
            top1,
            top10,
            max1,
            max10,
            programHeldPct,
            accountCount: accounts.length,
            walletCount: wallets.length,
          },
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

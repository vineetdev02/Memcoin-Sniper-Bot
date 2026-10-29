import { PublicKey } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { PUMPFUN_PROGRAM_ID } from "../feeds/program-ids.js";

/**
 * The line is `minCurveSol` (FILTER_MIN_CURVE_SOL, 1 by default): below it
 * nobody is holding the coin, and a 1% position is one of its biggest buys.
 * In the first paper session 46 of 86 entries were under 1 SOL and they lost
 * $148 between them, almost all of it the cost of getting in and out.
 */
const LAMPORTS_PER_SOL = 1_000_000_000;
// BondingCurve: 8-byte discriminator, five u64 reserves (real SOL is the fourth), then `complete: bool`
const REAL_SOL_OFFSET = 32;
const COMPLETE_OFFSET = 48;

export const curveDemandFilter: Filter = {
  id: "curve-demand",
  weight: 4,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const done = (
      status: "pass" | "fail" | "skip" | "error",
      reason: string,
      metadata?: Record<string, unknown>,
    ) => makeResult("curve-demand", status, reason, { metadata, durationMs: Date.now() - start });
    const min = ctx.cfg.minCurveSol;
    const verdict = (solIn: number) =>
      solIn >= min
        ? done("pass", `${solIn.toFixed(2)} SOL held in the curve`, { solIn, min })
        : done("fail", `only ${solIn.toFixed(2)} SOL held in the curve (min ${min})`, { solIn, min });

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const solIn = ctx.syntheticMock.curveSolIn;
      // events generated before this filter existed carry no figure
      return typeof solIn === "number" ? verdict(solIn) : done("skip", "no generated curve figure");
    }

    // an AMM pool has no curve to read
    if (pool.source !== "pumpfun") return done("skip", "not a bonding curve");

    try {
      const [curve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), new PublicKey(pool.tokenMint).toBuffer()],
        PUMPFUN_PROGRAM_ID,
      );
      const info = await ctx.conn.getAccountInfo(curve);
      if (!info || info.data.length <= COMPLETE_OFFSET) return done("skip", "bonding curve not readable yet");
      if (info.data[COMPLETE_OFFSET] === 1) return done("skip", "curve complete — the coin has migrated");
      return verdict(Number(info.data.readBigUInt64LE(REAL_SOL_OFFSET)) / LAMPORTS_PER_SOL);
    } catch (err) {
      return done("error", `RPC error: ${(err as Error).message}`);
    }
  },
};

import { PublicKey, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { fetchParsedTx } from "../feeds/parsers/common.js";
import { getPrisma } from "../state/db.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("filter:insider-detection");

const SIG_FETCH_LIMIT = 25;
const FUNDER_CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { funder: string | null; cachedAt: number }>();

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

async function findFunder(
  ctx: Parameters<Filter["evaluate"]>[1],
  wallet: string,
): Promise<string | null> {
  const cached = cache.get(wallet);
  if (cached && Date.now() - cached.cachedAt < FUNDER_CACHE_TTL_MS) return cached.funder;

  try {
    const sigs = await ctx.conn.getSignaturesForAddress(new PublicKey(wallet), {
      limit: SIG_FETCH_LIMIT,
    });
    if (sigs.length === 0) {
      cache.set(wallet, { funder: null, cachedAt: Date.now() });
      return null;
    }

    // Walk oldest → newest looking for the first SystemProgram transfer that
    // *deposits* SOL into our wallet. That's the funding source.
    const ordered = [...sigs].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
    for (const s of ordered) {
      const tx = await fetchParsedTx(ctx.conn, s.signature, 2);
      if (!tx) continue;
      const message = tx.transaction.message;
      const ixs = "instructions" in message ? message.instructions : [];
      for (const ix of ixs) {
        const programId = (ix as ParsedInstruction | PartiallyDecodedInstruction).programId.toBase58();
        if (programId !== SYSTEM_PROGRAM) continue;
        const parsed = (ix as ParsedInstruction).parsed as
          | { type?: string; info?: { source?: string; destination?: string; lamports?: number } }
          | undefined;
        if (!parsed || parsed.type !== "transfer") continue;
        const info = parsed.info ?? {};
        if (info.destination === wallet && info.source && info.source !== wallet) {
          cache.set(wallet, { funder: info.source, cachedAt: Date.now() });
          return info.source;
        }
      }
    }

    cache.set(wallet, { funder: null, cachedAt: Date.now() });
    return null;
  } catch (err) {
    log.warn({ err: (err as Error).message, wallet }, "funder lookup failed");
    return null;
  }
}

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

    const wallet = pool.creatorWallet;
    const funder = await findFunder(ctx, wallet);
    if (!funder) {
      return makeResult("insider-detection", "skip", "no funding source identified yet", {
        score: 50,
        metadata: { wallet, funder: null },
        durationMs: Date.now() - start,
      });
    }

    try {
      const prisma = getPrisma();
      const known = await prisma.ruggedDevWallet.findUnique({
        where: { walletAddress: funder },
      });
      if (known && known.rugRate > 0.3) {
        return makeResult(
          "insider-detection",
          "fail",
          `funder ${funder.slice(0, 8)}… is a known rugger (${(known.rugRate * 100).toFixed(0)}% rug rate, ${known.totalLaunches} launches)`,
          {
            metadata: { wallet, funder, funderRugRate: known.rugRate, funderLaunches: known.totalLaunches },
            durationMs: Date.now() - start,
          },
        );
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, funder }, "insider DB lookup failed");
    }

    return makeResult(
      "insider-detection",
      "pass",
      `funder ${funder.slice(0, 8)}… not on rugger list`,
      {
        score: 75,
        metadata: { wallet, funder },
        durationMs: Date.now() - start,
      },
    );
  },
};

import { PublicKey } from "@solana/web3.js";
import PQueue from "p-queue";
import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { PUMPFUN_PROGRAM_ID } from "../feeds/program-ids.js";
import { smartWallets } from "../analytics/smart-wallets.js";

// trades this soon after detection are what a 15 s wait can know about
export const EARLY_SEC = 15;
const MAX_TX = 25;
// a buy spends at least this much SOL; anything smaller is a fee or a transfer
const MIN_BUY_SOL = 0.01;
// Helius allows about 10 requests a second and throttles batches far sooner;
// leave room for the shadow tracker and the other filters
const rpcQueue = new PQueue({ concurrency: 4, intervalCap: 6, interval: 1000 });

interface RawTx {
  transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
  meta: { preBalances: number[]; postBalances: number[]; err: unknown } | null;
}

/**
 * Raw JSON-RPC: web3.js 1.x rejects version-1 transactions, which pump.fun
 * trades now include, so getTransaction goes around it.
 */
async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await rpcQueue.add(() =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method, params }),
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${method} returned ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  }
}

/** The wallets that bought, oldest first, each once; the creator left out. */
export function buyersFrom(txs: (RawTx | null)[], creator: string | null): string[] {
  const out: string[] = [];
  for (const tx of txs) {
    if (!tx?.meta || tx.meta.err) continue;
    const k = tx.transaction.message.accountKeys[0];
    const signer = typeof k === "string" ? k : k?.pubkey;
    const spent = (tx.meta.preBalances[0]! - tx.meta.postBalances[0]!) / 1e9;
    if (!signer || signer === creator || spent < MIN_BUY_SOL || out.includes(signer)) continue;
    out.push(signer);
  }
  return out;
}

async function earlyBuyers(url: string, mint: string, detectedAt: number, creator: string | null) {
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMPFUN_PROGRAM_ID);
  const sigs = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>(url, "getSignaturesForAddress", [
    curve.toBase58(),
    { limit: 1000 },
  ]);
  const cutoff = Math.floor(detectedAt / 1000) + EARLY_SEC;
  const early = sigs
    .reverse()
    .filter((s) => !s.err && s.blockTime !== null && s.blockTime <= cutoff)
    .slice(0, MAX_TX);
  const txs = await Promise.all(
    early.map((s) =>
      rpc<RawTx | null>(url, "getTransaction", [s.signature, { maxSupportedTransactionVersion: 1, encoding: "json" }]),
    ),
  );
  return { buyers: buyersFrom(txs, creator), txs: early.length };
}

/**
 * Passes a pump.fun launch when a wallet that keeps buying graduates early
 * bought this one in its first seconds. Every launch's early buyers go into
 * the result, so the shadow tracker's files are what the next list is built
 * from. Off unless a preset turns it on.
 */
export const smartMoneyFilter: Filter = {
  id: "smart-money",
  weight: 8,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const done = (status: "pass" | "fail" | "skip" | "error", reason: string, metadata?: Record<string, unknown>) =>
      makeResult("smart-money", status, reason, { metadata, durationMs: Date.now() - start });
    if (ctx.isSynthetic) return done("skip", "synthetic pool");
    if (pool.source !== "pumpfun") return done("skip", "pump.fun launches only");
    try {
      const [smart, early] = await Promise.all([
        smartWallets(),
        earlyBuyers(ctx.conn.rpcEndpoint, pool.tokenMint, pool.detectedAt, pool.creatorWallet ?? null),
      ]);
      const matched = early.buyers.filter((w) => smart.has(w));
      const metadata = { buyers: early.buyers, smart: matched, txs: early.txs, known: smart.size };
      if (smart.size === 0) return done("skip", "no smart wallets learned yet", metadata);
      return matched.length > 0
        ? done("pass", `${matched.length} smart wallet${matched.length > 1 ? "s" : ""} bought in the first ${EARLY_SEC}s`, metadata)
        : done("fail", `none of ${smart.size} smart wallets among ${early.buyers.length} early buyers`, metadata);
    } catch (err) {
      return done("error", `early buyers unreadable: ${(err as Error).message}`);
    }
  },
};

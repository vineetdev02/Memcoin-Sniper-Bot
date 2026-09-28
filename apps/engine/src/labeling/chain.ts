import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import PQueue from "p-queue";
import { PublicKey, type Connection } from "@solana/web3.js";
import { fetchParsedTx } from "../feeds/parsers/common.js";
import { PUMPFUN_PROGRAM_ID } from "../feeds/program-ids.js";
import { summarizeTx, type SigRow, type TxSummary } from "./outcome.js";

// A confirmed transaction never changes, so a re-run spends no RPC on what it already read.
const TX_CACHE_DIR = fileURLToPath(new URL("../../.cache/labeling/tx/", import.meta.url));
const PAGE_SIZE = 1000;

export interface SigListing {
  rows: (SigRow & { ok: boolean })[]; // oldest first
  complete: boolean;
}

/** Rate-limited, cached reads of the chain — the only part of labeling that does IO. */
export class Chain {
  private readonly conn: Connection;
  private readonly queue: PQueue;
  rpcCalls = 0;
  cacheHits = 0;

  constructor(conn: Connection, rps: number) {
    this.conn = conn;
    this.queue = new PQueue({ concurrency: rps, intervalCap: rps, interval: 1000 });
  }

  private rpc<T>(fn: () => Promise<T>): Promise<T> {
    this.rpcCalls++;
    return this.queue.add(fn);
  }

  async fetchTx(signature: string): Promise<TxSummary | null> {
    const file = path.join(TX_CACHE_DIR, `${signature}.json`);
    try {
      const hit = JSON.parse(await readFile(file, "utf8")) as TxSummary;
      this.cacheHits++;
      return hit;
    } catch {
      // not cached yet
    }
    const tx = await this.rpc(() => fetchParsedTx(this.conn, signature));
    const summary = tx ? summarizeTx(signature, tx) : null;
    if (summary) {
      await mkdir(TX_CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(summary));
    }
    return summary;
  }

  async fetchTxs(signatures: string[]): Promise<TxSummary[]> {
    const txs = await Promise.all(signatures.map((s) => this.fetchTx(s)));
    return txs.filter((t): t is TxSummary => t !== null).sort((a, b) => a.blockTime - b.blockTime);
  }

  /**
   * Page an address's history backwards from now. Complete means everything
   * newer than `until` (or than `stopBefore`) is in hand; running out of pages
   * first is reported rather than treated as the whole story.
   */
  async listSignatures(
    address: string,
    opts: { until?: string; stopBefore?: number; maxPages: number },
  ): Promise<SigListing> {
    const key = new PublicKey(address);
    const rows: SigListing["rows"] = [];
    let before: string | undefined;
    for (let page = 0; page < opts.maxPages; page++) {
      const batch = await this.rpc(() =>
        this.conn.getSignaturesForAddress(key, { before, until: opts.until, limit: PAGE_SIZE }),
      );
      for (const s of batch) {
        if (s.blockTime != null) rows.push({ signature: s.signature, t: s.blockTime, ok: s.err === null });
      }
      const last = batch[batch.length - 1];
      const reachedStop = opts.stopBefore !== undefined && (last?.blockTime ?? 0) < opts.stopBefore;
      if (!last || batch.length < PAGE_SIZE || reachedStop) {
        return { rows: rows.reverse(), complete: true };
      }
      before = last.signature;
    }
    return { rows: rows.reverse(), complete: false };
  }

  bondingCurve(mint: string): string {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
      PUMPFUN_PROGRAM_ID,
    );
    return pda.toBase58();
  }

  /** pump.fun BondingCurve: 8-byte discriminator, five u64 reserves, then `complete: bool`. */
  async curveComplete(curve: string): Promise<boolean | null> {
    const info = await this.rpc(() => this.conn.getAccountInfo(new PublicKey(curve)));
    if (!info || info.data.length < 49) return null;
    return info.data[48] === 1;
  }
}

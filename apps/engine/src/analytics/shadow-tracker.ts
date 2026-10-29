import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import type { OrchestratorVerdict, PoolEvent } from "@sniperbot/shared";
import { PUMPFUN_PROGRAM_ID } from "../feeds/program-ids.js";
import { childLogger } from "../utils/logger.js";
import type { LaunchTapeRecord } from "./launch-tape.js";

const log = childLogger("shadow");

/** Where the tracker writes and the shadow report reads, relative to the engine's folder. */
export const SHADOW_DIR = "data/shadow";

// one getMultipleAccounts call reads at most this many accounts
const BATCH = 100;
// BondingCurve: 8-byte discriminator, then u64 virtual token, virtual SOL, real token, real SOL reserves, supply, `complete`
const V_TOKEN_OFFSET = 8;
const V_SOL_OFFSET = 16;
const REAL_SOL_OFFSET = 32;
const COMPLETE_OFFSET = 48;

/** [seconds since the launch was detected, SOL held in the curve, price in lamports per raw token unit] */
export type CurveSample = [number, number, number];

export interface CurveState {
  solIn: number;
  price: number;
  complete: boolean;
}

/** The numbers a pump.fun BondingCurve account holds, or null for anything that is not one. */
export function readCurve(data: Buffer): CurveState | null {
  if (data.length <= COMPLETE_OFFSET) return null;
  const vToken = Number(data.readBigUInt64LE(V_TOKEN_OFFSET));
  // a graduated curve hands its reserves to the AMM and keeps only the flag
  if (vToken === 0) return data[COMPLETE_OFFSET] === 1 ? { solIn: 0, price: 0, complete: true } : null;
  return {
    solIn: Number(data.readBigUInt64LE(REAL_SOL_OFFSET)) / 1e9,
    price: Number(data.readBigUInt64LE(V_SOL_OFFSET)) / vToken,
    complete: data[COMPLETE_OFFSET] === 1,
  };
}

interface Followed {
  mint: string;
  curve: PublicKey;
  detectedAt: number;
  creator: string;
  // name, symbol and the creator's own buy, from PumpPortal's create message
  launch: unknown;
  verdictAt: number | null;
  record: Record<string, unknown> | null;
  tape: LaunchTapeRecord | null;
  samples: CurveSample[];
  last: CurveState | null;
  graduated: boolean;
}

/**
 * Follows every pump.fun launch from the moment it is detected, bought or not,
 * by reading its bonding curve every few seconds, and appends one NDJSON line
 * per launch: what each filter saw at the verdict, then the price path. A
 * session yields thousands of launches to test an entry delay, a filter or an
 * exit rule against, where the bot itself buys a few dozen.
 *
 * A sample is kept only when the curve changed, so a dead launch costs a line.
 */
export class ShadowTracker {
  private readonly followed = new Map<string, Followed>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  // set by stop(): a poll still awaiting the RPC must not write what stop() already wrote as cut
  private stopped = false;
  private written = 0;
  private readErrors = 0;

  constructor(
    private readonly conn: Pick<Connection, "getMultipleAccountsInfo">,
    private readonly dir: string,
    private readonly sampleMs = 3000,
    private readonly followMs = 22 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Start following a launch as soon as it is detected. */
  follow(pool: PoolEvent): void {
    if (pool.source !== "pumpfun" || this.followed.has(pool.tokenMint)) return;
    let curve: PublicKey;
    try {
      [curve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), new PublicKey(pool.tokenMint).toBuffer()],
        PUMPFUN_PROGRAM_ID,
      );
    } catch {
      return;
    }
    this.followed.set(pool.tokenMint, {
      mint: pool.tokenMint,
      curve,
      detectedAt: pool.detectedAt,
      creator: pool.creatorWallet,
      launch: pool.rawEvent ?? null,
      verdictAt: null,
      record: null,
      tape: null,
      samples: [],
      last: null,
      graduated: false,
    });
  }

  /** Who traded the launch in its first minutes, written with its path. */
  tape(mint: string, tape: LaunchTapeRecord): void {
    const f = this.followed.get(mint);
    if (f) f.tape = tape;
  }

  /** What the filters saw. A launch detected before this run started is not followed. */
  judged(v: OrchestratorVerdict): void {
    const f = this.followed.get(v.poolAddress);
    if (!f) return;
    const filters: Record<string, [string, unknown]> = {};
    for (const r of v.results) filters[r.filterId] = [r.status, r.metadata ?? null];
    f.verdictAt = v.decidedAt;
    f.record = { decision: v.decision, score: v.totalScore, reason: v.decisionReason, filters };
  }

  /**
   * Picks up the launches the last run wrote as cut and that are still inside
   * their window, so a restart costs a few seconds of samples rather than
   * every launch of the last 22 minutes. Their cut lines stay in the file;
   * everything that reads it skips cut lines.
   */
  async resume(): Promise<number> {
    const now = this.now();
    const days = new Set([now - this.followMs, now].map((t) => new Date(t).toISOString().slice(0, 10)));
    const cut = new Map<string, Record<string, unknown>>();
    const finished = new Set<string>();
    for (const day of days) {
      const text = await readFile(join(this.dir, `${day}.ndjson`), "utf8").catch(() => "");
      for (const raw of text.split("\n")) {
        if (!raw) continue;
        let l: Record<string, unknown>;
        try {
          l = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        const mint = l.mint as string;
        // a launch resumed once and then finished has a later line of its own
        if (l.end !== "cut") finished.add(mint);
        // cut twice: the later line holds every sample of the earlier one
        else if (typeof l.detectedAt === "number" && now - l.detectedAt < this.followMs) cut.set(mint, l);
      }
    }
    let resumed = 0;
    for (const [mint, l] of cut) {
      if (finished.has(mint) || this.followed.has(mint)) continue;
      let curve: PublicKey;
      try {
        [curve] = PublicKey.findProgramAddressSync(
          [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
          PUMPFUN_PROGRAM_ID,
        );
      } catch {
        continue;
      }
      const samples = (l.samples as CurveSample[] | undefined) ?? [];
      const last = samples[samples.length - 1];
      this.followed.set(mint, {
        mint,
        curve,
        detectedAt: l.detectedAt as number,
        creator: l.creator as string,
        launch: l.launch ?? null,
        verdictAt: (l.verdictAt as number | null) ?? null,
        record:
          l.decision == null ? null : { decision: l.decision, score: l.score, reason: l.reason, filters: l.filters },
        tape: (l.tape as LaunchTapeRecord | null) ?? null,
        samples,
        last: last ? { solIn: last[1], price: last[2], complete: false } : null,
        graduated: false,
      });
      resumed++;
    }
    if (resumed > 0) log.info({ resumed }, "resumed launches the last run cut short");
    return resumed;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.sampleMs);
    this.timer.unref();
    log.info({ dir: this.dir, sampleMs: this.sampleMs, followMin: this.followMs / 60_000 }, "shadow tracking on");
  }

  /** Writes what has been followed so far, marked `cut`, so a restart loses no launch outright. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const rest = [...this.followed.values()];
    this.followed.clear();
    await this.write(rest.map((f) => this.line(f, "cut")));
  }

  getStats() {
    return { following: this.followed.size, written: this.written, readErrors: this.readErrors };
  }

  async poll(): Promise<void> {
    if (this.polling || this.followed.size === 0) return;
    this.polling = true;
    try {
      const all = [...this.followed.values()];
      const done: string[] = [];
      for (let i = 0; i < all.length; i += BATCH) {
        const batch = all.slice(i, i + BATCH);
        let infos: (AccountInfo<Buffer> | null)[];
        try {
          infos = await this.conn.getMultipleAccountsInfo(batch.map((f) => f.curve));
        } catch (err) {
          this.readErrors++;
          log.debug({ err: (err as Error).message }, "curve batch read failed");
          continue;
        }
        const t = this.now();
        batch.forEach((f, j) => {
          const info = infos[j];
          const state = info ? readCurve(info.data) : null;
          // the emptied reserves of a graduated curve are not a price; its path ends at the last real one
          if (state && !state.complete && (!f.last || state.solIn !== f.last.solIn)) {
            f.samples.push([
              Math.round((t - f.detectedAt) / 100) / 10,
              Math.round(state.solIn * 1000) / 1000,
              Number(state.price.toPrecision(6)),
            ]);
            f.last = state;
          }
          if (state?.complete) {
            f.graduated = true;
            done.push(f.mint);
          }
        });
      }
      if (this.stopped) return;
      const t = this.now();
      for (const f of this.followed.values()) if (t - f.detectedAt >= this.followMs) done.push(f.mint);
      const lines: string[] = [];
      for (const mint of new Set(done)) {
        const f = this.followed.get(mint);
        if (!f) continue;
        this.followed.delete(mint);
        lines.push(this.line(f, f.graduated ? "complete" : "window"));
      }
      await this.write(lines);
    } finally {
      this.polling = false;
    }
  }

  private line(f: Followed, end: "window" | "complete" | "cut"): string {
    return JSON.stringify({
      mint: f.mint,
      creator: f.creator,
      launch: f.launch,
      detectedAt: f.detectedAt,
      verdictAt: f.verdictAt,
      ...(f.record ?? { decision: null }),
      end,
      followedSec: Math.round((this.now() - f.detectedAt) / 1000),
      tape: f.tape,
      samples: f.samples,
    });
  }

  private async write(lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const day = new Date(this.now()).toISOString().slice(0, 10);
      await appendFile(join(this.dir, `${day}.ndjson`), lines.join("\n") + "\n");
      this.written += lines.length;
    } catch (err) {
      log.warn({ err: (err as Error).message, lines: lines.length }, "shadow write failed");
    }
  }
}

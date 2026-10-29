import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { childLogger } from "../utils/logger.js";
import { readShadowLines, type ShadowLine } from "./shadow-report.js";
import { SHADOW_DIR } from "./shadow-tracker.js";

const log = childLogger("smart-wallets");

/**
 * Wallets that keep buying the launches that graduate, in their first
 * seconds. Replayed over 3,564 launches with the list rebuilt from launches
 * that had already ended, as it is here, 16% of the 82 launches such a wallet
 * bought early graduated against 1% of the rest; bought at 17 s they lost
 * $6.94 a trade. A graduation signal, not a strategy.
 */

// a wallet needs this many graduates among its early buys, at this rate, to count
export const MIN_GRADUATES = 2;
export const MIN_GRADUATE_RATE = 0.1;
const WINDOW_MS = 72 * 60 * 60 * 1000;
const REFRESH_MS = 30 * 60 * 1000;
// early buyers fetched for launches tracked before the filter existed, one launch a line
export const SMART_SEED = join(SHADOW_DIR, "..", "early-buyers.ndjson");

export interface EarlyBuys {
  mint: string;
  detectedAt: number;
  graduated: boolean;
  buyers: string[];
}

/** Every wallet with MIN_GRADUATES graduates among its early buys, at MIN_GRADUATE_RATE or better. */
export function pickSmartWallets(launches: EarlyBuys[]): Set<string> {
  const seen = new Map<string, { n: number; g: number }>();
  for (const l of launches) {
    for (const w of new Set(l.buyers)) {
      const s = seen.get(w) ?? { n: 0, g: 0 };
      s.n++;
      if (l.graduated) s.g++;
      seen.set(w, s);
    }
  }
  const out = new Set<string>();
  for (const [w, s] of seen) if (s.g >= MIN_GRADUATES && s.g / s.n >= MIN_GRADUATE_RATE) out.add(w);
  return out;
}

/** The early buyers the Smart Money filter recorded on a finished shadow line. */
export function earlyBuysOf(line: ShadowLine): EarlyBuys | null {
  if (!line.mint || line.detectedAt === undefined) return null;
  if (line.end !== "window" && line.end !== "complete") return null;
  const meta = line.filters?.["smart-money"]?.[1] as { buyers?: unknown } | null | undefined;
  if (!meta || !Array.isArray(meta.buyers)) return null;
  return { mint: line.mint, detectedAt: line.detectedAt, graduated: line.end === "complete", buyers: meta.buyers as string[] };
}

/** The seed file: {mint, detectedAt, graduated, creator, trades: [sec, wallet, solChange][]} a line. */
export function parseSeed(text: string): EarlyBuys[] {
  const out: EarlyBuys[] = [];
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    try {
      const d = JSON.parse(raw) as { mint: string; detectedAt: number; graduated: boolean; creator: string | null; trades: [number, string, number][] };
      // a buy spends SOL; the creator's own buy says nothing about anyone's judgement
      const buyers = d.trades.filter(([, w, sol]) => sol < -0.01 && w !== d.creator).map(([, w]) => w);
      out.push({ mint: d.mint, detectedAt: d.detectedAt, graduated: d.graduated, buyers });
    } catch {
      // a line half-written while the seed was being fetched
    }
  }
  return out;
}

let cached: { at: number; wallets: Set<string>; launches: number } | null = null;

/** The current smart wallets, from the last 72 hours of launches, rebuilt every 30 minutes. */
export async function smartWallets(now = Date.now()): Promise<Set<string>> {
  if (cached && now - cached.at < REFRESH_MS) return cached.wallets;
  const fromTs = now - WINDOW_MS;
  const byMint = new Map<string, EarlyBuys>();
  try {
    for (const l of parseSeed(await readFile(SMART_SEED, "utf8"))) if (l.detectedAt >= fromTs) byMint.set(l.mint, l);
  } catch {
    // no seed: the list grows from what the filter records
  }
  for (const line of await readShadowLines(SHADOW_DIR, fromTs, now)) {
    const l = earlyBuysOf(line);
    if (l && l.detectedAt >= fromTs) byMint.set(l.mint, l);
  }
  const wallets = pickSmartWallets([...byMint.values()]);
  cached = { at: now, wallets, launches: byMint.size };
  log.info({ wallets: wallets.size, launches: byMint.size }, "smart wallets rebuilt");
  return wallets;
}

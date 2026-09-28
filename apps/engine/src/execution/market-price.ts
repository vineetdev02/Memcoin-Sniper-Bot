import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("market-price");

const BATCH = 50; // Jupiter's per-request id limit
const TIMEOUT_MS = 4000;

export interface MarketQuote {
  priceUsd: number;
  // Jupiter's liquidity estimate for the token; null when it has none
  liquidityUsd: number | null;
  at: number;
}

export type QuoteFetcher = (mints: string[]) => Promise<Map<string, MarketQuote>>;

/**
 * A mint Jupiter does not price is left out, never set to zero: "no price" is
 * a different fact from "worthless", and callers decide what it means.
 */
export function parseQuotes(body: unknown, at: number): Map<string, MarketQuote> {
  const out = new Map<string, MarketQuote>();
  if (!body || typeof body !== "object") return out;
  for (const [mint, raw] of Object.entries(body as Record<string, unknown>)) {
    const q = raw as { usdPrice?: unknown; liquidity?: unknown } | null;
    if (!q || typeof q.usdPrice !== "number" || !(q.usdPrice > 0)) continue;
    out.set(mint, {
      priceUsd: q.usdPrice,
      liquidityUsd: typeof q.liquidity === "number" ? q.liquidity : null,
      at,
    });
  }
  return out;
}

/** Current USD prices from Jupiter's keyless price API — free, no RPC credits. */
export const fetchQuotes: QuoteFetcher = async (mints) => {
  const out = new Map<string, MarketQuote>();
  for (let i = 0; i < mints.length; i += BATCH) {
    const ids = mints.slice(i, i + BATCH);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${env.JUPITER_PRICE_API}?ids=${ids.join(",")}`, { signal: ctrl.signal });
      if (!res.ok) {
        log.warn({ status: res.status, count: ids.length }, "price lookup failed");
        continue;
      }
      for (const [mint, q] of parseQuotes(await res.json(), Date.now())) out.set(mint, q);
    } catch (err) {
      log.warn({ err: (err as Error).message, count: ids.length }, "price lookup failed");
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
};

/**
 * The latest market price of every open position, polled in one batch every
 * few seconds, so exits run on the market rather than on a simulation.
 */
export class MarketFeed {
  private readonly mints: () => string[];
  private readonly fetcher: QuoteFetcher;
  private readonly pollMs: number;
  private readonly latest = new Map<string, MarketQuote>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(mints: () => string[], fetcher: QuoteFetcher = fetchQuotes, pollMs = 3000) {
    this.mints = mints;
    this.fetcher = fetcher;
    this.pollMs = pollMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(mint: string): MarketQuote | undefined {
    return this.latest.get(mint);
  }

  /** One mint, now — for an entry, which cannot wait for the next poll. */
  async quote(mint: string): Promise<MarketQuote | undefined> {
    const q = (await this.fetcher([mint])).get(mint);
    if (q) this.latest.set(mint, q);
    return q;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const tracked = new Set(this.mints());
      for (const mint of this.latest.keys()) if (!tracked.has(mint)) this.latest.delete(mint);
      if (tracked.size === 0) return;
      // a mint missing from this answer keeps its last price, with its age
      for (const [mint, q] of await this.fetcher([...tracked])) this.latest.set(mint, q);
    } finally {
      this.polling = false;
    }
  }
}

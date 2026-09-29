import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { SOL_MINT } from "../feeds/parsers/common.js";

const log = childLogger("market-price");

const BATCH = 50; // Jupiter's per-request id limit
const TIMEOUT_MS = 4000;

/**
 * How far a real buy may sit from the price index and still be believed. A
 * $100 buy on a thin pump.fun curve pays ~3% over the index; one token paid
 * 114× the index's "price" because the index itself was wrong, and the bot
 * bought at the fake number and lost 99% when the index corrected.
 */
const ENTRY_MIN_RATIO = 0.8;
const ENTRY_MAX_RATIO = 1.25;

/**
 * A mark that moves this many times over in one poll is held until the next
 * poll confirms it, so one bad tick cannot fire a fake take-profit or stop.
 * A real collapse is acted on one poll (3s) later.
 */
const JUMP_FACTOR = 3;
const CONFIRM_FACTOR = 1.5;

export interface MarketQuote {
  priceUsd: number;
  // Jupiter's liquidity estimate for the token; null when it has none
  liquidityUsd: number | null;
  // the token's decimals, needed to turn a raw quote amount into a price
  decimals: number | null;
  at: number;
}

export type QuoteFetcher = (mints: string[]) => Promise<Map<string, MarketQuote>>;
/** Raw token units a real buy of `lamports` would receive; null when there is no route. */
export type BuyQuoter = (mint: string, lamports: number) => Promise<number | null>;

export type EntryQuote =
  | { ok: true; priceUsd: number; liquidityUsd: number | null; premiumPct: number }
  | { ok: false; reason: string };

/**
 * A mint Jupiter does not price is left out, never set to zero: "no price" is
 * a different fact from "worthless", and callers decide what it means.
 */
export function parseQuotes(body: unknown, at: number): Map<string, MarketQuote> {
  const out = new Map<string, MarketQuote>();
  if (!body || typeof body !== "object") return out;
  for (const [mint, raw] of Object.entries(body as Record<string, unknown>)) {
    const q = raw as { usdPrice?: unknown; liquidity?: unknown; decimals?: unknown } | null;
    if (!q || typeof q.usdPrice !== "number" || !(q.usdPrice > 0)) continue;
    out.set(mint, {
      priceUsd: q.usdPrice,
      liquidityUsd: typeof q.liquidity === "number" ? q.liquidity : null,
      decimals: typeof q.decimals === "number" ? q.decimals : null,
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

/** Jupiter's executable quote: what a real SOL → token swap would return right now. */
export const quoteBuy: BuyQuoter = async (mint, lamports) => {
  const url = new URL(`${env.JUPITER_QUOTE_API}/quote`);
  url.searchParams.set("inputMint", SOL_MINT);
  url.searchParams.set("outputMint", mint);
  url.searchParams.set("amount", String(Math.round(lamports)));
  url.searchParams.set("slippageBps", "300");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { outAmount?: string; routePlan?: unknown[] };
    const out = Number(body.outAmount);
    return body.routePlan && body.routePlan.length > 0 && out > 0 ? out : null;
  } catch (err) {
    log.warn({ err: (err as Error).message, mint: mint.slice(0, 8) }, "buy quote failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The price a real buy of `sizeUsd` would pay, checked against the index.
 * Pure: the numbers come in, a verdict goes out.
 */
export function checkEntryPrice(p: {
  sizeUsd: number;
  index: MarketQuote;
  tokensOutRaw: number;
}): EntryQuote {
  if (p.index.decimals === null) return { ok: false, reason: "token decimals unknown" };
  const tokens = p.tokensOutRaw / 10 ** p.index.decimals;
  if (!(tokens > 0)) return { ok: false, reason: "buy quote returned no tokens" };
  const priceUsd = p.sizeUsd / tokens;
  const ratio = priceUsd / p.index.priceUsd;
  const premiumPct = (ratio - 1) * 100;
  if (ratio < ENTRY_MIN_RATIO || ratio > ENTRY_MAX_RATIO) {
    return {
      ok: false,
      reason: `price index ($${p.index.priceUsd.toPrecision(3)}) and a real buy ($${priceUsd.toPrecision(3)}) disagree by ${premiumPct.toFixed(0)}%`,
    };
  }
  return { ok: true, priceUsd, liquidityUsd: p.index.liquidityUsd, premiumPct };
}

const isJump = (a: number, b: number, factor: number) => Math.max(a, b) / Math.min(a, b) >= factor;

/**
 * The latest market price of every open position, polled in one batch every
 * few seconds, so exits run on the market rather than on a simulation.
 */
export class MarketFeed {
  private readonly mints: () => string[];
  private readonly fetcher: QuoteFetcher;
  private readonly buyQuoter: BuyQuoter;
  private readonly pollMs: number;
  private readonly latest = new Map<string, MarketQuote>();
  // a jump seen once, waiting for the next poll to confirm it
  private readonly unconfirmed = new Map<string, MarketQuote>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    mints: () => string[],
    fetcher: QuoteFetcher = fetchQuotes,
    pollMs = 3000,
    buyQuoter: BuyQuoter = quoteBuy,
  ) {
    this.mints = mints;
    this.fetcher = fetcher;
    this.pollMs = pollMs;
    this.buyQuoter = buyQuoter;
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

  /**
   * The price to enter at, now: what a real buy of `sizeUsd` would pay, taken
   * only when the price index agrees with it — the index is what every exit
   * is judged against afterwards.
   */
  async entryQuote(mint: string, sizeUsd: number): Promise<EntryQuote> {
    const index = await this.fetcher([mint, SOL_MINT]);
    const token = index.get(mint);
    const sol = index.get(SOL_MINT);
    if (!token) return { ok: false, reason: "no market price" };
    if (!sol) return { ok: false, reason: "no SOL price" };
    const tokensOutRaw = await this.buyQuoter(mint, (sizeUsd / sol.priceUsd) * 1e9);
    if (tokensOutRaw === null) return { ok: false, reason: "no route to buy it" };
    const entry = checkEntryPrice({ sizeUsd, index: token, tokensOutRaw });
    if (entry.ok) {
      this.latest.set(mint, token);
      this.unconfirmed.delete(mint);
    }
    return entry;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const tracked = new Set(this.mints());
      for (const mint of this.latest.keys()) if (!tracked.has(mint)) this.latest.delete(mint);
      for (const mint of this.unconfirmed.keys()) if (!tracked.has(mint)) this.unconfirmed.delete(mint);
      if (tracked.size === 0) return;
      // a mint missing from this answer keeps its last price, with its age
      for (const [mint, q] of await this.fetcher([...tracked])) this.accept(mint, q);
    } finally {
      this.polling = false;
    }
  }

  private accept(mint: string, q: MarketQuote): void {
    const prev = this.latest.get(mint);
    if (!prev || !isJump(prev.priceUsd, q.priceUsd, JUMP_FACTOR)) {
      this.latest.set(mint, q);
      this.unconfirmed.delete(mint);
      return;
    }
    const seen = this.unconfirmed.get(mint);
    if (seen && !isJump(seen.priceUsd, q.priceUsd, CONFIRM_FACTOR)) {
      // the second reading agrees: the move is real
      this.latest.set(mint, q);
      this.unconfirmed.delete(mint);
      return;
    }
    log.warn(
      { mint: mint.slice(0, 8), from: prev.priceUsd, to: q.priceUsd },
      "price jumped more than 3× in one poll — waiting for the next poll to confirm",
    );
    this.unconfirmed.set(mint, q);
  }
}

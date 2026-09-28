import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("dexscreener");

export interface DexScreenerSocial {
  type: string;
  url: string;
}

export interface DexScreenerWebsite {
  url: string;
  label?: string;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: { address: string; name?: string; symbol?: string };
  quoteToken: { address: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  info?: {
    imageUrl?: string;
    websites?: DexScreenerWebsite[];
    socials?: DexScreenerSocial[];
  };
  boosts?: { active?: number };
  pairCreatedAt?: number;
}

interface CacheEntry {
  pair: DexScreenerPair | null;
  cachedAt: number;
}

const CACHE_TTL_MS = 15_000;
const FETCH_TIMEOUT_MS = 3500;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DexScreenerPair | null>>();

/**
 * The token's most liquid DexScreener pair. Takes the token mint: the engine
 * stores the mint as `poolAddress` for every source, and the pairs endpoint
 * this used to call answers `pairs: null` for a mint — so the social and
 * volume filters never had data on a real pool.
 */
export async function fetchPair(tokenMint: string): Promise<DexScreenerPair | null> {
  const hit = cache.get(tokenMint);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.pair;

  const existing = inflight.get(tokenMint);
  if (existing) return existing;

  const p = doFetch(tokenMint).finally(() => inflight.delete(tokenMint));
  inflight.set(tokenMint, p);
  return p;
}

/** Most liquid first; pump.fun curve pairs report no liquidity and rank last. */
export function pickPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
  let best: DexScreenerPair | null = null;
  for (const p of pairs) {
    if (!best || (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)) best = p;
  }
  return best;
}

async function doFetch(tokenMint: string): Promise<DexScreenerPair | null> {
  const url = `${env.DEXSCREENER_BASE}/tokens/v1/solana/${tokenMint}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      if (res.status !== 404) log.warn({ status: res.status, tokenMint }, "dexscreener non-ok");
      cache.set(tokenMint, { pair: null, cachedAt: Date.now() });
      return null;
    }
    const body = (await res.json()) as DexScreenerPair[] | { pairs?: DexScreenerPair[] | null };
    const pair = pickPair(Array.isArray(body) ? body : (body.pairs ?? []));
    cache.set(tokenMint, { pair, cachedAt: Date.now() });
    return pair;
  } catch (err) {
    const e = err as Error;
    if (e.name !== "AbortError") log.warn({ err: e.message, tokenMint }, "dexscreener fetch failed");
    cache.set(tokenMint, { pair: null, cachedAt: Date.now() });
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function invalidate(tokenMint: string): void {
  cache.delete(tokenMint);
}

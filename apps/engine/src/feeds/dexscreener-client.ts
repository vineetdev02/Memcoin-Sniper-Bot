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

export async function fetchPair(poolAddress: string): Promise<DexScreenerPair | null> {
  const hit = cache.get(poolAddress);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.pair;

  const existing = inflight.get(poolAddress);
  if (existing) return existing;

  const p = doFetch(poolAddress).finally(() => inflight.delete(poolAddress));
  inflight.set(poolAddress, p);
  return p;
}

async function doFetch(poolAddress: string): Promise<DexScreenerPair | null> {
  const url = `${env.DEXSCREENER_BASE}/latest/dex/pairs/solana/${poolAddress}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      if (res.status !== 404) log.warn({ status: res.status, poolAddress }, "dexscreener non-ok");
      cache.set(poolAddress, { pair: null, cachedAt: Date.now() });
      return null;
    }
    const body = (await res.json()) as { pair?: DexScreenerPair; pairs?: DexScreenerPair[] };
    const pair = body.pair ?? body.pairs?.[0] ?? null;
    cache.set(poolAddress, { pair, cachedAt: Date.now() });
    return pair;
  } catch (err) {
    const e = err as Error;
    if (e.name !== "AbortError") log.warn({ err: e.message, poolAddress }, "dexscreener fetch failed");
    cache.set(poolAddress, { pair: null, cachedAt: Date.now() });
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function invalidate(poolAddress: string): void {
  cache.delete(poolAddress);
}

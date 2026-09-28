/**
 * Outcome-based fixture labels (FILTER_QUALITY_PLAN §11.16). Everything here is
 * pure: it reads transaction summaries that label-fixtures.ts already fetched,
 * so the rules can be tested without a network.
 *
 *   rug      liquidity fell >90% within 24h of creation AND the creator took
 *            quote out of the pool inside that drop
 *   good     after 7 days liquidity is still ≥50% of its peak over those 7 days
 *   honeypot nobody but the creator ever sold, despite real buyers
 *
 * Liquidity is measured as the pool's quote reserve (SOL, or USDC for USDC
 * pairs), not USD — a SOL price move must never be what labels a pool.
 */
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { SOL_MINT } from "../feeds/parsers/common.js";

export type Label = "rug" | "good" | "honeypot";

export const RUG_WINDOW_SEC = 24 * 3600;
export const RUG_DROP_FRAC = 0.9;
export const GOOD_HORIZON_SEC = 7 * 24 * 3600;
export const GOOD_RETAIN_FRAC = 0.5;
export const HONEYPOT_MIN_BUYERS = 3;
export const HONEYPOT_MIN_AGE_SEC = 24 * 3600;
// A creator gain below this share of the peak reserve is rent and dust, not a withdrawal.
export const WITHDRAWAL_MIN_FRAC_OF_PEAK = 0.01;

export interface TokenRow {
  account: string;
  mint: string;
  owner: string | null;
  pre: number;
  post: number;
  // absent from preTokenBalances: the account was opened by this transaction
  opened: boolean;
}

/** The parts of a transaction the labeler reads, small enough to cache on disk. */
export interface TxSummary {
  signature: string;
  blockTime: number;
  ok: boolean;
  feePayer: string;
  feeLamports: number;
  keys: string[];
  preLamports: number[];
  postLamports: number[];
  tokens: TokenRow[];
}

export function summarizeTx(signature: string, tx: ParsedTransactionWithMeta): TxSummary | null {
  const meta = tx.meta;
  if (!meta || tx.blockTime == null) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const feePayer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
  if (!feePayer) return null;

  const rows = new Map<number, TokenRow>();
  const amount = (a: { amount: string; decimals: number }) => Number(a.amount) / 10 ** a.decimals;
  for (const b of meta.preTokenBalances ?? []) {
    rows.set(b.accountIndex, {
      account: keys[b.accountIndex] ?? "",
      mint: b.mint,
      owner: b.owner ?? null,
      pre: amount(b.uiTokenAmount),
      post: 0,
      opened: false,
    });
  }
  for (const b of meta.postTokenBalances ?? []) {
    const row = rows.get(b.accountIndex);
    if (row) row.post = amount(b.uiTokenAmount);
    else {
      rows.set(b.accountIndex, {
        account: keys[b.accountIndex] ?? "",
        mint: b.mint,
        owner: b.owner ?? null,
        pre: 0,
        post: amount(b.uiTokenAmount),
        opened: true,
      });
    }
  }

  return {
    signature,
    blockTime: tx.blockTime,
    ok: meta.err === null,
    feePayer,
    feeLamports: meta.fee,
    keys,
    preLamports: meta.preBalances,
    postLamports: meta.postBalances,
    tokens: [...rows.values()].filter((r) => r.account),
  };
}

// ---------------------------------------------------------------------------
// Vaults
// ---------------------------------------------------------------------------

export interface Vaults {
  // pump.fun keeps SOL as the bonding curve's own lamports; AMMs keep a token account
  quote: { account: string; kind: "lamports" | "token" };
  base: string;
}

export interface VaultQuery {
  tokenMint: string;
  quoteMint: string;
  creator: string;
  // set for pump.fun: the bonding-curve PDA
  bondingCurve?: string;
}

/**
 * Find the pool's reserve accounts from its creation transaction. The engine
 * stores the token mint as `poolAddress` for every source, so the pool cannot
 * be read directly — but the account that received liquidity in the creation
 * transaction, and is not the creator's, is the vault. Ambiguity returns a
 * reason instead of a guess.
 */
export function resolveVaults(creation: TxSummary, q: VaultQuery): Vaults | string {
  if (q.bondingCurve) {
    if (!creation.keys.includes(q.bondingCurve)) return "bonding curve is not in the creation tx";
    const base = creation.tokens.find((r) => r.owner === q.bondingCurve && r.mint === q.tokenMint);
    if (!base) return "bonding curve holds no token account in the creation tx";
    return { quote: { account: q.bondingCurve, kind: "lamports" }, base: base.account };
  }

  const quote = pickVault(creation, q.quoteMint, q.creator);
  if ("reason" in quote) return `quote vault: ${quote.reason}`;
  const base = pickVault(creation, q.tokenMint, q.creator);
  if ("reason" in base) return `base vault: ${base.reason}`;
  return { quote: { account: quote.account, kind: "token" }, base: base.account };
}

function pickVault(tx: TxSummary, mint: string, creator: string): { account: string } | { reason: string } {
  const candidates = tx.tokens.filter((r) => r.mint === mint && r.owner !== creator);
  const gain = (r: TokenRow) => r.post - r.pre;
  const funded = candidates.filter((r) => gain(r) > 0).sort((a, b) => gain(b) - gain(a));
  const [top, next] = funded;
  if (top && (!next || gain(top) > gain(next))) return { account: top.account };
  if (top) return { reason: "two accounts received the same deposit" };
  // a launchpad opens an empty quote vault and fills it with the first buy
  const opened = candidates.filter((r) => r.opened && r.post === 0);
  if (opened.length === 1 && opened[0]) return { account: opened[0].account };
  return { reason: opened.length > 1 ? "several empty accounts opened" : "no non-creator account received it" };
}

// ---------------------------------------------------------------------------
// Reading one transaction
// ---------------------------------------------------------------------------

export function quoteReserve(tx: TxSummary, v: Vaults): { pre: number; post: number } | null {
  if (v.quote.kind === "lamports") {
    const i = tx.keys.indexOf(v.quote.account);
    if (i < 0) return null;
    return { pre: (tx.preLamports[i] ?? 0) / 1e9, post: (tx.postLamports[i] ?? 0) / 1e9 };
  }
  const row = tx.tokens.find((r) => r.account === v.quote.account);
  return row ? { pre: row.pre, post: row.post } : null;
}

export type Flow = "buy" | "sell" | "add" | "remove" | "none";

/** Direction from the pool's side: quote in and tokens out is somebody buying. */
export function classifyFlow(tx: TxSummary, v: Vaults): Flow {
  const q = quoteReserve(tx, v);
  if (!q) return "none";
  const base = tx.tokens.find((r) => r.account === v.base);
  const dq = q.post - q.pre;
  const db = base ? base.post - base.pre : 0;
  const eps = 1e-9;
  if (dq > eps && db < -eps) return "buy";
  if (dq < -eps && db > eps) return "sell";
  if (dq > eps && db > eps) return "add";
  if (dq < -eps && db < -eps) return "remove";
  return "none";
}

/** Quote the creator came out of this transaction with, fee added back. */
export function creatorQuoteGain(tx: TxSummary, creator: string, quoteMint: string): number {
  let gain = 0;
  if (quoteMint === SOL_MINT) {
    const i = tx.keys.indexOf(creator);
    if (i >= 0) {
      const fee = tx.feePayer === creator ? tx.feeLamports : 0;
      gain += ((tx.postLamports[i] ?? 0) - (tx.preLamports[i] ?? 0) + fee) / 1e9;
    }
  }
  for (const r of tx.tokens) {
    if (r.owner === creator && r.mint === quoteMint) gain += r.post - r.pre;
  }
  return gain;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface SigRow {
  signature: string;
  t: number;
}

/**
 * Offsets from creation at which to read the reserve when a pool has too many
 * transactions to read them all: dense while memecoins move, sparse after.
 */
export function sampleGrid(): number[] {
  const out: number[] = [];
  for (let s = 300; s <= 6 * 3600; s += 300) out.push(s);
  for (let s = 6 * 3600 + 1800; s <= 24 * 3600; s += 1800) out.push(s);
  for (let s = 24 * 3600 + 3 * 3600; s <= GOOD_HORIZON_SEC; s += 3 * 3600) out.push(s);
  return out;
}

/** For each grid point, the last transaction at or before it — the state the pool was in. */
export function sampleAt<T extends SigRow>(sigs: T[], t0: number, offsets: number[]): T[] {
  const picked = new Map<string, T>();
  for (const off of offsets) {
    const target = t0 + off;
    let lo = 0;
    let hi = sigs.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((sigs[mid]?.t ?? Infinity) <= target) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const s = sigs[found];
    if (s) picked.set(s.signature, s);
  }
  return [...picked.values()].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

export interface ReservePoint {
  t: number;
  reserve: number;
  signature: string;
}

export function reservePoints(txs: TxSummary[], v: Vaults): ReservePoint[] {
  const out: ReservePoint[] = [];
  for (const tx of txs) {
    const q = quoteReserve(tx, v);
    if (q) out.push({ t: tx.blockTime, reserve: q.post, signature: tx.signature });
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface Collapse {
  peak: number;
  peakAt: number;
  low: number;
  lowAt: number;
}

/** First point inside the window that sits below 10% of the peak reached before it. */
export function findCollapse(points: ReservePoint[], t0: number): Collapse | null {
  let peak = 0;
  let peakAt = t0;
  for (const p of points) {
    if (p.t > t0 + RUG_WINDOW_SEC) break;
    if (p.reserve > peak) {
      peak = p.reserve;
      peakAt = p.t;
    } else if (peak > 0 && p.reserve < peak * (1 - RUG_DROP_FRAC)) {
      return { peak, peakAt, low: p.reserve, lowAt: p.t };
    }
  }
  return null;
}

export interface Survival {
  peak: number;
  atHorizon: number;
  retainedPct: number;
}

export function measureSurvival(points: ReservePoint[], t0: number): Survival | null {
  const inside = points.filter((p) => p.t <= t0 + GOOD_HORIZON_SEC);
  const last = inside[inside.length - 1];
  if (!last) return null;
  const peak = Math.max(...inside.map((p) => p.reserve));
  if (peak <= 0) return null;
  return { peak, atHorizon: last.reserve, retainedPct: (last.reserve / peak) * 100 };
}

export interface Withdrawal {
  signature: string;
  amount: number;
}

/** The creator taking quote out of the pool: their gain in a tx where the reserve fell. */
export function findWithdrawal(
  txs: TxSummary[],
  v: Vaults,
  creator: string,
  quoteMint: string,
  minAmount: number,
): Withdrawal | null {
  let best: Withdrawal | null = null;
  for (const tx of txs) {
    const flow = classifyFlow(tx, v);
    if (flow !== "sell" && flow !== "remove") continue;
    const amount = creatorQuoteGain(tx, creator, quoteMint);
    if (amount >= minAmount && (!best || amount > best.amount)) best = { signature: tx.signature, amount };
  }
  return best;
}

export interface Traders {
  buyers: Set<string>;
  sellers: Set<string>;
}

/**
 * Buyers and sellers other than the creator. A honeypot whitelists its owner by
 * design, so a creator sell must never be what clears one.
 */
export function tallyTraders(txs: TxSummary[], v: Vaults, creator: string, into?: Traders): Traders {
  const t = into ?? { buyers: new Set<string>(), sellers: new Set<string>() };
  for (const tx of txs) {
    if (tx.feePayer === creator) continue;
    const flow = classifyFlow(tx, v);
    if (flow === "buy") t.buyers.add(tx.feePayer);
    if (flow === "sell") t.sellers.add(tx.feePayer);
  }
  return t;
}

export type Check = "yes" | "no" | "unknown";

export interface Verdicts {
  honeypot: Check;
  rug: Check;
  good: Check;
}

/**
 * Most specific label wins. Anything that is not a clear yes stays unlabeled —
 * a wrong fixture poisons every precision number computed against it.
 */
export function decideLabel(v: Verdicts): Label | null {
  if (v.honeypot === "yes") return "honeypot";
  if (v.rug === "yes") return "rug";
  if (v.good === "yes" && v.rug === "no" && v.honeypot !== "unknown") return "good";
  return null;
}

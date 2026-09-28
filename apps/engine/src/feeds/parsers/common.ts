import {
  type Connection,
  type ParsedTransactionWithMeta,
  type VersionedTransactionResponse,
  type ParsedAccountData,
} from "@solana/web3.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const KNOWN_QUOTE_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

// Pessimistic SOL price for unfunded estimates. Replaced by live oracle later.
export const SOL_PRICE_USD_FALLBACK = 180;

export async function fetchParsedTx(
  conn: Connection,
  signature: string,
  retries = 3,
): Promise<ParsedTransactionWithMeta | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const tx = await conn.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (tx) return tx;
    } catch {
      // fall through to retry
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
}

export interface NewMintInfo {
  mint: string;
  decimals: number;
}

/**
 * Extract token mints that appeared in postTokenBalances but not preTokenBalances.
 * For new pool creations, this is the freshly-minted token.
 */
export function getNewMints(tx: ParsedTransactionWithMeta): NewMintInfo[] {
  const pre = new Set((tx.meta?.preTokenBalances ?? []).map((b) => b.mint));
  const post = tx.meta?.postTokenBalances ?? [];
  const seen = new Set<string>();
  const result: NewMintInfo[] = [];
  for (const b of post) {
    if (pre.has(b.mint) || seen.has(b.mint)) continue;
    if (KNOWN_QUOTE_MINTS.has(b.mint)) continue;
    seen.add(b.mint);
    result.push({ mint: b.mint, decimals: b.uiTokenAmount.decimals });
  }
  return result;
}

/**
 * Get fee payer (first signer) from a parsed tx — best-effort proxy for the
 * launching wallet when the IDL isn't being decoded.
 */
export function getFeePayer(tx: ParsedTransactionWithMeta): string | null {
  const message = tx.transaction.message;
  if (!("accountKeys" in message)) return null;
  const signer = message.accountKeys.find((k) => k.signer);
  return signer ? signer.pubkey.toBase58() : null;
}

/**
 * Look at SOL balance changes around the tx and infer how much SOL was
 * deposited into a pool / curve. Sums *negative* deltas from non-fee-payer
 * accounts as a rough liquidity estimate.
 */
export function estimateSolDeposited(tx: ParsedTransactionWithMeta): number {
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  if (pre.length !== post.length || pre.length === 0) return 0;

  let totalLamportsIn = 0;
  for (let i = 1; i < pre.length; i++) {
    const delta = (post[i] ?? 0) - (pre[i] ?? 0);
    if (delta > 0) totalLamportsIn += delta;
  }
  return totalLamportsIn / 1_000_000_000;
}

/**
 * Detect the traded token and its quote mint from a pool-creation tx. The
 * quote is one of the KNOWN_QUOTE_MINTS. Creating an AMM pool also creates
 * its LP mint, so two unknown mints appear: the token already existed (it is
 * in preTokenBalances, being deposited), the LP mint did not. Taking whichever
 * came last stored the LP mint as the token for PumpSwap and Raydium pools.
 */
export function detectPairFromBalances(
  tx: ParsedTransactionWithMeta,
): { baseMint: string; quoteMint: string } | null {
  const post = tx.meta?.postTokenBalances ?? [];
  const pre = new Set((tx.meta?.preTokenBalances ?? []).map((b) => b.mint));
  const mints = new Set(post.map((b) => b.mint));
  const quoteMint = [...mints].find((m) => KNOWN_QUOTE_MINTS.has(m)) ?? SOL_MINT;
  const candidates = [...mints].filter((m) => !KNOWN_QUOTE_MINTS.has(m));
  const existing = candidates.filter((m) => pre.has(m));
  if (existing.length === 1 && existing[0]) return { baseMint: existing[0], quoteMint };
  if (candidates.length === 1 && candidates[0]) return { baseMint: candidates[0], quoteMint };
  // several candidates and no single pre-existing one: refuse rather than guess
  return null;
}

export type AnyParsedTx = ParsedTransactionWithMeta | VersionedTransactionResponse;
export type { ParsedAccountData };

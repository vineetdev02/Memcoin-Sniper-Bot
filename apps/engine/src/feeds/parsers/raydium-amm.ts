import type { Connection } from "@solana/web3.js";
import type { PoolEvent } from "@sniperbot/shared";
import { childLogger } from "../../utils/logger.js";
import {
  detectPairFromBalances,
  estimateSolDeposited,
  fetchParsedTx,
  getFeePayer,
  SOL_MINT,
  SOL_PRICE_USD_FALLBACK,
  USDC_MINT,
  USDT_MINT,
} from "./common.js";

const log = childLogger("parser:raydium-amm");

export async function parseRaydiumAmmInitialize(
  signature: string,
  detectedAt: number,
  conn: Connection,
): Promise<PoolEvent | null> {
  const tx = await fetchParsedTx(conn, signature);
  if (!tx) return null;

  const pair = detectPairFromBalances(tx);
  if (!pair) {
    log.debug({ signature }, "no base mint detected");
    return null;
  }

  const creator = getFeePayer(tx);
  if (!creator) return null;

  // Use SOL deposit as proxy for liquidity if quote is SOL; otherwise use USDC value.
  const solDeposited = estimateSolDeposited(tx);
  let initialLiquidityUsd = 0;
  if (pair.quoteMint === SOL_MINT) {
    initialLiquidityUsd = solDeposited * SOL_PRICE_USD_FALLBACK * 2;
  } else if (pair.quoteMint === USDC_MINT || pair.quoteMint === USDT_MINT) {
    const usdcDelta = (tx.meta?.postTokenBalances ?? []).find(
      (b) => b.mint === pair.quoteMint,
    );
    const amount = Number(usdcDelta?.uiTokenAmount.uiAmountString ?? "0");
    initialLiquidityUsd = amount * 2;
  }

  // Pool address: best-effort. The amm account is typically the first writable
  // non-signer account in the initialize2 instruction. Without IDL decode we
  // fall back to the new base mint identifier; we resolve precisely in Phase 2
  // when we add IDL-aware decoding.
  const poolAddress = pair.baseMint;
  const initialPriceUsd = initialLiquidityUsd > 0
    ? initialLiquidityUsd / 1_000_000_000
    : 0;

  return {
    poolAddress,
    tokenMint: pair.baseMint,
    baseMint: pair.quoteMint,
    source: "raydium-amm",
    initialLiquidityUsd,
    initialPriceUsd,
    creatorWallet: creator,
    detectedAt,
    signature,
  };
}

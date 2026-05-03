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
} from "./common.js";

const log = childLogger("parser:pumpswap");

/**
 * PumpSwap CreatePool fires when a pump.fun bonding curve graduates to an AMM.
 * The token mint already existed; what's new is the pool itself. Detection
 * uses the same balance-delta heuristic as Raydium with a different source tag.
 */
export async function parsePumpSwapCreatePool(
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

  const solDeposited = estimateSolDeposited(tx);
  const initialLiquidityUsd =
    pair.quoteMint === SOL_MINT ? solDeposited * SOL_PRICE_USD_FALLBACK * 2 : 0;
  const initialPriceUsd = initialLiquidityUsd > 0
    ? initialLiquidityUsd / 1_000_000_000
    : 0;

  return {
    poolAddress: pair.baseMint,
    tokenMint: pair.baseMint,
    baseMint: pair.quoteMint,
    source: "pumpswap",
    initialLiquidityUsd,
    initialPriceUsd,
    creatorWallet: creator,
    detectedAt,
    signature,
  };
}

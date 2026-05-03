import type { Connection } from "@solana/web3.js";
import type { PoolEvent } from "@sniperbot/shared";
import { childLogger } from "../../utils/logger.js";
import {
  fetchParsedTx,
  getFeePayer,
  getNewMints,
  SOL_MINT,
  SOL_PRICE_USD_FALLBACK,
} from "./common.js";

const log = childLogger("parser:pumpfun");

// pump.fun bonding curves start with ~30 virtual SOL of price-impact reserve
// and 1B token supply on the virtual side. The *real* SOL in the curve at
// creation is ~0 — a sniper buys in to seed real liquidity. We estimate
// initial mcap from the virtual reserves to reflect the price the curve quotes.
const PUMPFUN_VIRTUAL_SOL_RESERVES = 30;
const PUMPFUN_VIRTUAL_TOKEN_RESERVES = 1_073_000_000;

export async function parsePumpFunCreate(
  signature: string,
  detectedAt: number,
  conn: Connection,
): Promise<PoolEvent | null> {
  const tx = await fetchParsedTx(conn, signature);
  if (!tx) {
    log.debug({ signature }, "tx not yet available");
    return null;
  }

  const newMints = getNewMints(tx);
  const tokenMint = newMints[0]?.mint;
  if (!tokenMint) {
    log.debug({ signature }, "no new mint in tx");
    return null;
  }

  const creator = getFeePayer(tx);
  if (!creator) {
    log.debug({ signature }, "no fee payer");
    return null;
  }

  const initialPriceSol = PUMPFUN_VIRTUAL_SOL_RESERVES / PUMPFUN_VIRTUAL_TOKEN_RESERVES;
  const initialPriceUsd = initialPriceSol * SOL_PRICE_USD_FALLBACK;
  const initialLiquidityUsd = PUMPFUN_VIRTUAL_SOL_RESERVES * SOL_PRICE_USD_FALLBACK;

  return {
    poolAddress: tokenMint,
    tokenMint,
    baseMint: SOL_MINT,
    source: "pumpfun",
    initialLiquidityUsd,
    initialPriceUsd,
    creatorWallet: creator,
    detectedAt,
    signature,
  };
}

import type { Connection } from "@solana/web3.js";
import type { PoolEvent, DexSource } from "@sniperbot/shared";
import { parsePumpFunCreate } from "./pumpfun.js";
import { parseRaydiumAmmInitialize } from "./raydium-amm.js";
import { parsePumpSwapCreatePool } from "./pumpswap.js";

export type ParserFn = (
  signature: string,
  detectedAt: number,
  conn: Connection,
) => Promise<PoolEvent | null>;

const PARSERS: Partial<Record<DexSource, ParserFn>> = {
  pumpfun: parsePumpFunCreate,
  pumpswap: parsePumpSwapCreatePool,
  "raydium-amm": parseRaydiumAmmInitialize,
};

export function getParser(source: DexSource): ParserFn | null {
  return PARSERS[source] ?? null;
}

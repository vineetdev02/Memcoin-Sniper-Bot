export type DexSource =
  | "pumpfun"
  | "pumpswap"
  | "raydium-amm"
  | "raydium-clmm"
  | "raydium-launchpad"
  | "meteora"
  | "orca";

export interface PoolEvent {
  poolAddress: string;
  tokenMint: string;
  baseMint: string;
  source: DexSource;
  initialLiquidityUsd: number;
  initialPriceUsd: number;
  creatorWallet: string;
  detectedAt: number;
  signature: string;
  rawEvent?: unknown;
}

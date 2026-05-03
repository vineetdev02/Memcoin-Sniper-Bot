import { PublicKey } from "@solana/web3.js";
import type { DexSource } from "@sniperbot/shared";

export interface ProgramTarget {
  source: DexSource;
  programId: PublicKey;
  description: string;
  // Log lines we look for to detect a pool/curve creation
  creationMarkers: string[];
}

export const PUMPFUN_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export const PUMPSWAP_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);

export const RAYDIUM_AMM_V4_PROGRAM_ID = new PublicKey(
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
);

export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
);

// Raydium Launchpad / LetsBonk - the canonical ID rotates as the launchpad
// evolves; keep configurable via env so we can swap without redeploying.
export const RAYDIUM_LAUNCHPAD_PROGRAM_ID = new PublicKey(
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
);

export const METEORA_DLMM_PROGRAM_ID = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
);

export const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);

export const PROGRAM_TARGETS: ProgramTarget[] = [
  {
    source: "pumpfun",
    programId: PUMPFUN_PROGRAM_ID,
    description: "pump.fun bonding curve launches",
    creationMarkers: ["Program log: Instruction: Create", "InitializeMint"],
  },
  {
    source: "pumpswap",
    programId: PUMPSWAP_PROGRAM_ID,
    description: "PumpSwap AMM pools (graduated from pump.fun)",
    creationMarkers: ["Program log: Instruction: CreatePool"],
  },
  {
    source: "raydium-amm",
    programId: RAYDIUM_AMM_V4_PROGRAM_ID,
    description: "Raydium AMM v4 standard pools",
    creationMarkers: ["Program log: initialize2", "Program log: ray_log"],
  },
  {
    source: "raydium-clmm",
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    description: "Raydium concentrated liquidity pools",
    creationMarkers: ["Program log: Instruction: CreatePool"],
  },
  {
    source: "raydium-launchpad",
    programId: RAYDIUM_LAUNCHPAD_PROGRAM_ID,
    description: "Raydium Launchpad / LetsBonk",
    creationMarkers: ["Program log: Instruction: Initialize"],
  },
  {
    source: "meteora",
    programId: METEORA_DLMM_PROGRAM_ID,
    description: "Meteora DLMM dynamic bins",
    creationMarkers: ["Program log: Instruction: InitializeLbPair"],
  },
  {
    source: "orca",
    programId: ORCA_WHIRLPOOL_PROGRAM_ID,
    description: "Orca Whirlpools concentrated liquidity",
    creationMarkers: ["Program log: Instruction: InitializePool"],
  },
];

import { env } from "../config/env.js";

export function getEnabledTargets(): ProgramTarget[] {
  const enabled: Record<DexSource, boolean> = {
    pumpfun: env.ENABLE_PUMPFUN,
    pumpswap: env.ENABLE_PUMPSWAP,
    "raydium-amm": env.ENABLE_RAYDIUM_AMM,
    "raydium-clmm": env.ENABLE_RAYDIUM_CLMM,
    "raydium-launchpad": env.ENABLE_RAYDIUM_LAUNCHPAD,
    meteora: env.ENABLE_METEORA,
    orca: env.ENABLE_ORCA,
  };
  return PROGRAM_TARGETS.filter((t) => enabled[t.source]);
}

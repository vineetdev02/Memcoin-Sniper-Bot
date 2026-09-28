import type { FilterId } from "./filter.js";

/**
 * Runtime overrides on top of the env-baked defaults. Any key omitted falls
 * back to the engine's env value.
 */
export interface FilterConfigDelta {
  enabled?: Partial<Record<FilterId, boolean>>;
  thresholds?: {
    liquidityMinUsd?: number;
    liquidityMaxUsd?: number;
    lpLockedRequired?: boolean;
    mintAuthRenounced?: boolean;
    freezeAuthRenounced?: boolean;
    topHolderMaxPct?: number;
    top10HoldersMaxPct?: number;
    devRugRateMax?: number;
    honeypotSimRequired?: boolean;
    maxSellTaxPct?: number;
    bundledLaunchReject?: boolean;
    minFilterScore?: number;
  };
}

export interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  config: FilterConfigDelta;
  isActive: boolean;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export const BUILT_IN_PRESETS: ReadonlyArray<{
  name: string;
  description: string;
  config: FilterConfigDelta;
}> = [
  {
    name: "Safe Sniper",
    description:
      "Strict — only trade pools that pass every critical filter. Lower hit count, higher quality.",
    config: {
      enabled: {
        "honeypot-sim": true,
        "lp-locked": true,
        "mint-authority": true,
        "freeze-authority": true,
        "dev-wallet": true,
        "top-holders": true,
        "liquidity-min": true,
        // The two costliest filters in RPC calls. Insider can only pass while
        // the rugger list is empty; bundle mostly sees too few early buyers
        // this soon after launch. Turn back on from the Filters page.
        "bundled-launch": false,
        "insider-detection": false,
      },
      thresholds: {
        minFilterScore: 80,
        topHolderMaxPct: 12,
        top10HoldersMaxPct: 30,
        devRugRateMax: 0.2,
        liquidityMinUsd: 8000,
        maxSellTaxPct: 5,
      },
    },
  },
  {
    name: "Aggressive",
    description:
      "Looser thresholds — more trades, more noise. Use after filter analytics identify winners.",
    config: {
      enabled: {
        "honeypot-sim": true,
        "lp-locked": true,
        "mint-authority": true,
        "freeze-authority": true,
        "dev-wallet": true,
        // costliest in RPC calls; see Safe Sniper
        "bundled-launch": false,
        "insider-detection": false,
      },
      thresholds: {
        minFilterScore: 55,
        topHolderMaxPct: 22,
        top10HoldersMaxPct: 50,
        devRugRateMax: 0.45,
        liquidityMinUsd: 3000,
        maxSellTaxPct: 12,
      },
    },
  },
  {
    name: "Learning",
    description:
      "Honeypot-only gating. Snipes everything else to gather analytics data. Run for a week.",
    config: {
      enabled: {
        "honeypot-sim": true,
        "lp-locked": false,
        "mint-authority": false,
        "freeze-authority": false,
        "dev-wallet": false,
        "top-holders": false,
        "liquidity-min": false,
        "bundled-launch": false,
        "insider-detection": false,
        "social-signal": false,
        "volume-velocity": false,
        "anti-sniper-war": false,
      },
      thresholds: {
        minFilterScore: 0,
      },
    },
  },
];

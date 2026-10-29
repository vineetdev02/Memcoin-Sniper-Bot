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
    // SOL a pump.fun curve must hold when it is judged (the Demand filter)
    minCurveSol?: number;
    // coins one creator may have launched in the last 24 hours (Dev History); 0 turns the check off
    devMaxLaunches24h?: number;
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
    name: "Hot Start",
    description:
      "pump.fun only — buy a curve already holding 20 SOL. Set Wait before judging to 15 s. Loses far less than buying every launch, but has not been shown to make money: see the Strategy check.",
    config: {
      // On a pump.fun curve the safety filters always pass, so what decides is
      // the Demand filter's 20 SOL. In 1,051 shadow-tracked launches, a curve
      // that full 15-20 s after launch was the one group that made money in
      // both halves of the night (+$5.89 a trade, n=21). On the launches after
      // it was chosen it lost $3.85 a trade (n=43), against $5.32 for buying
      // everything: the least-bad rule found, not a profitable one. Everything that
      // judges the early trading itself is off; Sniper War's rejects pumped
      // more often than its passes.
      enabled: {
        "honeypot-sim": true,
        "mint-authority": true,
        "freeze-authority": true,
        "curve-demand": true,
        "lp-locked": false,
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
        minCurveSol: 20,
        // every enabled filter must pass: a curve read that errors is not a buy
        minFilterScore: 100,
      },
    },
  },
  {
    name: "Smart Money",
    description:
      "pump.fun only — buy when a wallet that keeps picking graduates bought in the first 15 s. Set Wait before judging to 15 s. Picks graduates (16% against 1%) but lost $6.94 a trade in replay: for study, not profit.",
    config: {
      // Replayed the way the filter runs, each launch judged by wallets picked
      // from launches that had already ended: of 82 launches a smart wallet
      // bought in its first 15 s, 16% graduated against 1% of the rest, and
      // bought at 17 s they lost $6.94 a trade. It finds graduates and still
      // does not pay. Every launch's early buyers are recorded, so the list
      // and the test grow on their own.
      enabled: {
        "honeypot-sim": true,
        "mint-authority": true,
        "freeze-authority": true,
        "smart-money": true,
        "curve-demand": false,
        "lp-locked": false,
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
        // every enabled filter must pass: unreadable early buyers are not a buy
        minFilterScore: 100,
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
        "curve-demand": false,
        "anti-sniper-war": false,
      },
      thresholds: {
        minFilterScore: 0,
      },
    },
  },
];

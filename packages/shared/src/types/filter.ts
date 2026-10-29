export type FilterId =
  | "liquidity-min"
  | "lp-locked"
  | "mint-authority"
  | "freeze-authority"
  | "top-holders"
  | "dev-wallet"
  | "bundled-launch"
  | "insider-detection"
  | "honeypot-sim"
  | "social-signal"
  | "volume-velocity"
  | "curve-demand"
  | "anti-sniper-war"
  | "smart-money";

export const FILTER_LABELS: Record<FilterId, string> = {
  "liquidity-min": "Liquidity",
  "lp-locked": "LP Locked",
  "mint-authority": "Mint Auth",
  "freeze-authority": "Freeze Auth",
  "top-holders": "Top Holders",
  "dev-wallet": "Dev History",
  "bundled-launch": "Bundle Check",
  "insider-detection": "Insider",
  "honeypot-sim": "Honeypot",
  "social-signal": "Social",
  "volume-velocity": "Volume",
  "curve-demand": "Demand",
  "anti-sniper-war": "Sniper War",
  "smart-money": "Smart Money",
};

export const FILTER_ORDER: FilterId[] = [
  "honeypot-sim",
  "lp-locked",
  "mint-authority",
  "freeze-authority",
  "dev-wallet",
  "top-holders",
  "liquidity-min",
  "bundled-launch",
  "insider-detection",
  "anti-sniper-war",
  "volume-velocity",
  "curve-demand",
  "smart-money",
  "social-signal",
];

/**
 * Filters a preset has to turn on by name. Every other filter runs unless a
 * preset turns it off, which is right for a safety check and wrong for one
 * that passes a few launches in a hundred: a preset saved before it existed
 * would stop trading.
 */
const OFF_UNLESS_CHOSEN: ReadonlySet<FilterId> = new Set<FilterId>(["smart-money"]);
export const filterOnByDefault = (id: FilterId): boolean => !OFF_UNLESS_CHOSEN.has(id);

export type FilterStatus = "pass" | "fail" | "skip" | "error";

export interface FilterResult {
  filterId: FilterId;
  status: FilterStatus;
  score: number;
  reason: string;
  metadata?: Record<string, unknown>;
  evaluatedAt: number;
  durationMs: number;
}

export type Decision = "snipe" | "reject";

export interface OrchestratorVerdict {
  poolAddress: string;
  signature: string;
  source: string;
  totalScore: number;
  maxScore: number;
  passedCount: number;
  failedCount: number;
  decision: Decision;
  decisionReason: string;
  results: FilterResult[];
  decidedAt: number;
  totalDurationMs: number;
}

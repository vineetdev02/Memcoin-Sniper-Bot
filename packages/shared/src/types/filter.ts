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
  | "anti-sniper-war";

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
  "anti-sniper-war": "Sniper War",
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
  "social-signal",
];

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

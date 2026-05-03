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

export interface FilterResult {
  filterId: FilterId;
  passed: boolean;
  score: number;
  reason: string;
  metadata?: Record<string, unknown>;
  evaluatedAt: number;
  durationMs: number;
}

export interface OrchestratorVerdict {
  poolAddress: string;
  results: FilterResult[];
  totalScore: number;
  decision: "snipe" | "reject";
  decisionReason: string;
}

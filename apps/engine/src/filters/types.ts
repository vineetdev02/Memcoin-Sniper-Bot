import type { Connection } from "@solana/web3.js";
import type {
  FilterId,
  FilterResult,
  FilterStatus,
  PoolEvent,
} from "@sniperbot/shared";
import type { ResolvedFilterConfig } from "../config/filter-config.js";

export interface FilterContext {
  conn: Connection;
  isSynthetic: boolean;
  /**
   * Pre-computed filter answers baked into synthetic pool events. Filters
   * consult this first when running against synthetic data to avoid hitting
   * real APIs with fake mints.
   */
  syntheticMock?: SyntheticMock;
  /**
   * Resolved filter config for THIS evaluation. Threaded explicitly so a
   * concurrent backtest cannot mutate live evaluations.
   */
  cfg: ResolvedFilterConfig;
}

export interface SyntheticMock {
  mintAuthRenounced: boolean;
  freezeAuthRenounced: boolean;
  lpStatus: "burned" | "locked" | "unlocked";
  topHolderPct: number;
  top10HoldersPct: number;
  devRugRate: number;
  devLaunchCount: number;
  honeypotSafe: boolean;
  sellTaxPct: number;
  bundledLaunch: boolean;
  insiderFunded: boolean;
  socialScore: number;
  earlyTxCount: number;
  buySellRatio: number;
}

export interface Filter {
  readonly id: FilterId;
  readonly weight: number;
  enabled: boolean;
  evaluate(pool: PoolEvent, ctx: FilterContext): Promise<FilterResult>;
}

export function makeResult(
  id: FilterId,
  status: FilterStatus,
  reason: string,
  options: {
    score?: number;
    metadata?: Record<string, unknown>;
    durationMs?: number;
  } = {},
): FilterResult {
  const score = options.score ?? (status === "pass" ? 100 : 0);
  return {
    filterId: id,
    status,
    score,
    reason,
    metadata: options.metadata,
    evaluatedAt: Date.now(),
    durationMs: options.durationMs ?? 0,
  };
}

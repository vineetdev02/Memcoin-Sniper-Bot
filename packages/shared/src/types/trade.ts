export type TradeSide = "buy" | "sell";
export type TradeStatus = "filled" | "failed" | "partial";
export type ExitReason =
  | "tp1"
  | "tp2"
  | "tp3"
  | "tp4"
  | "stop-loss"
  | "trailing-stop"
  | "time-exit"
  | "rug-pull"
  | "kill-switch"
  | "manual";

export interface Trade {
  id: string;
  positionId: string;
  side: TradeSide;
  status: TradeStatus;
  priceUsd: number;
  amountTokens: number;
  amountUsd: number;
  feeSol: number;
  slippagePct: number;
  mevPenaltyPct?: number;
  exitReason?: ExitReason;
  signature?: string;
  executedAt: number;
}

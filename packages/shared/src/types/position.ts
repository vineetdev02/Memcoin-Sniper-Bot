export type PositionStatus = "open" | "partial" | "closed";

export interface TPLevel {
  gainPct: number;
  sellPct: number;
  hit: boolean;
  hitAt?: number;
}

export interface Position {
  id: string;
  poolAddress: string;
  tokenMint: string;
  mode: "paper" | "live";
  entryPriceUsd: number;
  entrySizeUsd: number;
  tokensHeld: number;
  currentPriceUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  peakPriceUsd: number;
  tpLadder: TPLevel[];
  stopLossPct: number;
  trailingStopArmed: boolean;
  openedAt: number;
  closedAt?: number;
  status: PositionStatus;
}

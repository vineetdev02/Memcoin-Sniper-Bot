import type { ExitReason } from "./trade.js";

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
  tokenSymbol?: string;
  source: string;
  mode: "paper" | "live";
  entryPriceUsd: number;
  entrySizeUsd: number;
  remainingTokens: number;
  initialTokens: number;
  currentPriceUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  peakPriceUsd: number;
  peakGainPct: number;
  tpLadder: TPLevel[];
  stopLossPct: number;
  trailingStopPct: number;
  trailingStopActivationPct: number;
  trailingStopArmed: boolean;
  timeExitMin: number;
  filterScore: number;
  openedAt: number;
  closedAt?: number;
  closeReason?: ExitReason;
  status: PositionStatus;
}

export interface PositionOpenedEvent {
  type: "position-opened";
  position: Position;
}

export interface PositionUpdateEvent {
  type: "position-update";
  positionId: string;
  currentPriceUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  peakPriceUsd: number;
  peakGainPct: number;
  trailingStopArmed: boolean;
  tpLadder: TPLevel[];
  remainingTokens: number;
  realizedPnlUsd: number;
  status: PositionStatus;
}

export interface PositionClosedEvent {
  type: "position-closed";
  position: Position;
}

export interface BankrollSnapshot {
  balanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openExposureUsd: number;
  openPositionCount: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  takenAt: number;
}

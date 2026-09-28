"use client";

import { io, type Socket } from "socket.io-client";
import type {
  AnalyticsSnapshot,
  BacktestSummary,
  BankrollSnapshot,
  FilterConfigDelta,
  FilterPreset,
  OrchestratorVerdict,
  PoolEvent,
  Position,
  PositionClosedEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
  StatsWindowKey,
  TradeStatsWindow,
} from "@sniperbot/shared";

export interface SystemStatus {
  mode: "paper" | "live";
  detectedTotal: number;
  skipped: number;
  queued: number;
  uptime: number;
  syntheticFeed: boolean;
  snipes: number;
  rejects: number;
  filterCount: number;
  filterQueue: number;
  openPositions: number;
  realizedPnlUsd: number;
  activePreset: string | null;
}

export interface ServerToClientEvents {
  "pool:new": (event: PoolEvent) => void;
  "verdict:new": (verdict: OrchestratorVerdict) => void;
  "system:status": (status: SystemStatus) => void;
  "position:opened": (e: PositionOpenedEvent) => void;
  "position:update": (e: PositionUpdateEvent) => void;
  "position:closed": (e: PositionClosedEvent) => void;
  "bankroll:snapshot": (snap: BankrollSnapshot) => void;
  "preset:changed": (msg: { activeName: string | null }) => void;
}

export interface ClientToServerEvents {
  "pool:replay": (count: number, ack: (events: PoolEvent[]) => void) => void;
  "verdict:replay": (
    count: number,
    ack: (verdicts: OrchestratorVerdict[]) => void,
  ) => void;
  "positions:list": (
    ack: (data: { open: Position[]; recentlyClosed: Position[] }) => void,
  ) => void;
  "bankroll:get": (ack: (snap: BankrollSnapshot) => void) => void;
  "analytics:get": (ack: (snap: AnalyticsSnapshot) => void) => void;
  "stats:get": (
    windowKey: StatsWindowKey,
    ack: (result: { ok: boolean; stats?: TradeStatsWindow; error?: string }) => void,
  ) => void;
  "presets:list": (
    ack: (data: { presets: FilterPreset[]; activeName: string | null }) => void,
  ) => void;
  "preset:activate": (
    presetId: string,
    ack: (result: { ok: boolean; preset?: FilterPreset; error?: string }) => void,
  ) => void;
  "preset:deactivate": (ack: (result: { ok: boolean }) => void) => void;
  "preset:save": (
    payload: { name: string; description?: string; config: FilterConfigDelta },
    ack: (result: { ok: boolean; preset?: FilterPreset; error?: string }) => void,
  ) => void;
  "preset:delete": (
    presetId: string,
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "backtest:run": (
    payload: { presetName: string; config: FilterConfigDelta; limit?: number },
    ack: (result: { ok: boolean; summary?: BacktestSummary; error?: string }) => void,
  ) => void;
}

export type SniperSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: SniperSocket | null = null;

export function getSocket(url?: string): SniperSocket {
  if (socket) return socket;
  const endpoint =
    url ?? process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:4000";
  socket = io(endpoint, {
    autoConnect: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

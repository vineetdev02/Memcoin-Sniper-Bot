"use client";

import { io, type Socket } from "socket.io-client";
import type {
  BankrollSnapshot,
  OrchestratorVerdict,
  PoolEvent,
  Position,
  PositionClosedEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
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
}

export interface ServerToClientEvents {
  "pool:new": (event: PoolEvent) => void;
  "verdict:new": (verdict: OrchestratorVerdict) => void;
  "system:status": (status: SystemStatus) => void;
  "position:opened": (e: PositionOpenedEvent) => void;
  "position:update": (e: PositionUpdateEvent) => void;
  "position:closed": (e: PositionClosedEvent) => void;
  "bankroll:snapshot": (snap: BankrollSnapshot) => void;
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

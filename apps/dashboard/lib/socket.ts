"use client";

import { io, type Socket } from "socket.io-client";
import type { PoolEvent } from "@sniperbot/shared";

export interface SystemStatus {
  mode: "paper" | "live";
  detectedTotal: number;
  skipped: number;
  queued: number;
  uptime: number;
  syntheticFeed: boolean;
}

export interface ServerToClientEvents {
  "pool:new": (event: PoolEvent) => void;
  "system:status": (status: SystemStatus) => void;
}

export interface ClientToServerEvents {
  "pool:replay": (count: number, ack: (events: PoolEvent[]) => void) => void;
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

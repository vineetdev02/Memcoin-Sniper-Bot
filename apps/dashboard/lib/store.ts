"use client";

import { create } from "zustand";
import type { PoolEvent } from "@sniperbot/shared";
import type { SystemStatus } from "./socket";

const MAX_POOLS = 200;

interface FeedState {
  pools: PoolEvent[];
  status: SystemStatus | null;
  connected: boolean;
  addPool: (event: PoolEvent) => void;
  setStatus: (status: SystemStatus) => void;
  setConnected: (connected: boolean) => void;
  replacePools: (pools: PoolEvent[]) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  pools: [],
  status: null,
  connected: false,
  addPool: (event) =>
    set((state) => {
      if (state.pools.some((p) => p.signature === event.signature)) return state;
      const next = [event, ...state.pools];
      if (next.length > MAX_POOLS) next.length = MAX_POOLS;
      return { pools: next };
    }),
  setStatus: (status) => set({ status }),
  setConnected: (connected) => set({ connected }),
  replacePools: (pools) => set({ pools: pools.slice(0, MAX_POOLS) }),
}));

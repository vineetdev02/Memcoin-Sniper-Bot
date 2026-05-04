"use client";

import { create } from "zustand";
import type {
  BankrollSnapshot,
  OrchestratorVerdict,
  PoolEvent,
  Position,
} from "@sniperbot/shared";
import type { SystemStatus } from "./socket";

const MAX_POOLS = 200;
const MAX_CLOSED = 100;

export interface PoolWithVerdict {
  pool: PoolEvent;
  verdict?: OrchestratorVerdict;
}

interface FeedState {
  pools: PoolWithVerdict[];
  status: SystemStatus | null;
  connected: boolean;
  expandedSig: string | null;

  openPositions: Map<string, Position>;
  closedPositions: Position[];
  bankroll: BankrollSnapshot | null;

  addPool: (event: PoolEvent) => void;
  addVerdict: (verdict: OrchestratorVerdict) => void;
  setStatus: (status: SystemStatus) => void;
  setConnected: (connected: boolean) => void;
  replacePools: (pools: PoolEvent[]) => void;
  applyVerdicts: (verdicts: OrchestratorVerdict[]) => void;
  toggleExpanded: (sig: string) => void;

  hydratePositions: (open: Position[], closed: Position[]) => void;
  positionOpened: (p: Position) => void;
  positionUpdated: (
    id: string,
    patch: Partial<Position>,
  ) => void;
  positionClosed: (p: Position) => void;
  setBankroll: (snap: BankrollSnapshot) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  pools: [],
  status: null,
  connected: false,
  expandedSig: null,

  openPositions: new Map(),
  closedPositions: [],
  bankroll: null,

  addPool: (event) =>
    set((state) => {
      if (state.pools.some((p) => p.pool.signature === event.signature)) return state;
      const next = [{ pool: event }, ...state.pools];
      if (next.length > MAX_POOLS) next.length = MAX_POOLS;
      return { pools: next };
    }),

  addVerdict: (verdict) =>
    set((state) => ({
      pools: state.pools.map((p) =>
        p.pool.signature === verdict.signature ? { ...p, verdict } : p,
      ),
    })),

  setStatus: (status) => set({ status }),
  setConnected: (connected) => set({ connected }),

  replacePools: (pools) =>
    set({
      pools: pools.slice(0, MAX_POOLS).map((pool) => ({ pool })),
    }),

  applyVerdicts: (verdicts) =>
    set((state) => {
      const bySig = new Map(verdicts.map((v) => [v.signature, v]));
      return {
        pools: state.pools.map((p) => ({
          ...p,
          verdict: bySig.get(p.pool.signature) ?? p.verdict,
        })),
      };
    }),

  toggleExpanded: (sig) =>
    set((state) => ({ expandedSig: state.expandedSig === sig ? null : sig })),

  hydratePositions: (open, closed) =>
    set({
      openPositions: new Map(open.map((p) => [p.id, p])),
      closedPositions: closed.slice(0, MAX_CLOSED),
    }),

  positionOpened: (p) =>
    set((state) => {
      const next = new Map(state.openPositions);
      next.set(p.id, p);
      return { openPositions: next };
    }),

  positionUpdated: (id, patch) =>
    set((state) => {
      const cur = state.openPositions.get(id);
      if (!cur) return state;
      const next = new Map(state.openPositions);
      next.set(id, { ...cur, ...patch });
      return { openPositions: next };
    }),

  positionClosed: (p) =>
    set((state) => {
      const nextOpen = new Map(state.openPositions);
      nextOpen.delete(p.id);
      const nextClosed = [p, ...state.closedPositions].slice(0, MAX_CLOSED);
      return { openPositions: nextOpen, closedPositions: nextClosed };
    }),

  setBankroll: (snap) => set({ bankroll: snap }),
}));

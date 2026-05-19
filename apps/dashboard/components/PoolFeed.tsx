"use client";

import { useState } from "react";
import { useFeedStore } from "@/lib/store";
import { PoolRow } from "./PoolRow";
import { Radio, MousePointerClick } from "lucide-react";
import { useEffect } from "react";

type FilterMode = "all" | "snipe" | "reject" | "pending";

export function PoolFeed() {
  const pools = useFeedStore((s) => s.pools);
  const connected = useFeedStore((s) => s.connected);
  const [, force] = useState(0);
  const [mode, setMode] = useState<FilterMode>("all");

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const filtered = pools.filter(({ verdict }) => {
    if (mode === "all") return true;
    if (mode === "pending") return !verdict;
    return verdict?.decision === mode;
  });

  const newestSig = pools[0]?.pool.signature;

  const counts = {
    all: pools.length,
    snipe: pools.filter((p) => p.verdict?.decision === "snipe").length,
    reject: pools.filter((p) => p.verdict?.decision === "reject").length,
    pending: pools.filter((p) => !p.verdict).length,
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio
            className={`h-4 w-4 ${connected ? "text-accent-green animate-pulse-fast" : "text-fg-dim"}`}
          />
          <h2 className="text-sm font-semibold tracking-tight">Live Pools</h2>
          <span className="text-xs text-fg-subtle">
            {pools.length === 0 ? "" : `${pools.length} in feed`}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border bg-bg-card p-1">
          {(["all", "snipe", "reject", "pending"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                mode === m
                  ? m === "snipe"
                    ? "bg-accent-green/15 text-accent-green"
                    : m === "reject"
                      ? "bg-accent-red/15 text-accent-red"
                      : "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {m}
              <span className="font-mono tabular-nums text-fg-subtle">{counts[m]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Legend — what the filter boxes mean */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border-subtle bg-bg-card/40 px-3 py-1.5 text-[10px] text-fg-subtle">
        <div className="flex items-center gap-1.5">
          <MousePointerClick className="h-3 w-3" />
          <span>Click any row to see why</span>
        </div>
        <span className="text-border-strong">·</span>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-accent-green/30 bg-accent-green/15 font-mono text-[8px] font-bold text-accent-green">
            ✓
          </span>
          <span>filter passed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-accent-red/30 bg-accent-red/15 font-mono text-[8px] font-bold text-accent-red">
            ✕
          </span>
          <span>failed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-border-subtle bg-bg-elevated font-mono text-[8px] font-bold text-fg-dim">
            —
          </span>
          <span>skipped</span>
        </div>
        <span className="text-border-strong">·</span>
        <span className="opacity-80">12 boxes per row = 1 per filter (hover for details)</span>
      </div>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <EmptyState connected={connected} mode={mode} />
        ) : (
          filtered.map(({ pool, verdict }) => (
            <PoolRow
              key={pool.signature}
              pool={pool}
              verdict={verdict}
              isNew={pool.signature === newestSig}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EmptyState({ connected, mode }: { connected: boolean; mode: FilterMode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-card py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-elevated">
        <Radio className={`h-5 w-5 ${connected ? "text-accent-green animate-pulse-fast" : "text-fg-dim"}`} />
      </div>
      <p className="mt-3 text-sm font-medium text-fg-muted">
        {connected
          ? mode === "all"
            ? "Waiting for pools…"
            : `No ${mode} pools yet`
          : "Connecting to engine…"}
      </p>
      <p className="mt-1 text-xs text-fg-subtle max-w-sm px-6">
        {connected
          ? "New launches stream here in real time as filters evaluate them."
          : "Make sure the engine is running on port 4000."}
      </p>
    </div>
  );
}

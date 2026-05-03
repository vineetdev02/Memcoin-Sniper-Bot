"use client";

import { useFeedStore } from "@/lib/store";
import { PoolRow } from "./PoolRow";
import { Radio } from "lucide-react";
import { useEffect, useState } from "react";

export function PoolFeed() {
  const pools = useFeedStore((s) => s.pools);
  const connected = useFeedStore((s) => s.connected);
  const [, force] = useState(0);

  // Re-render every second so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const newestSig = pools[0]?.signature;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio
            className={`h-4 w-4 ${
              connected ? "text-accent-green animate-pulse-fast" : "text-fg-dim"
            }`}
          />
          <h2 className="text-sm font-semibold tracking-tight">Live Pools</h2>
          <span className="text-xs text-fg-subtle">
            {pools.length === 0 ? "" : `${pools.length} in feed`}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {pools.length === 0 ? (
          <EmptyState connected={connected} />
        ) : (
          pools.map((pool) => (
            <PoolRow
              key={pool.signature}
              pool={pool}
              isNew={pool.signature === newestSig}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-card py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-elevated">
        <Radio
          className={`h-5 w-5 ${
            connected ? "text-accent-green animate-pulse-fast" : "text-fg-dim"
          }`}
        />
      </div>
      <p className="mt-3 text-sm font-medium text-fg-muted">
        {connected ? "Waiting for pools…" : "Connecting to engine…"}
      </p>
      <p className="mt-1 text-xs text-fg-subtle max-w-sm px-6">
        {connected
          ? "New pool launches will appear here in real time. Enable SYNTHETIC_FEED=true in .env to see test data."
          : "Make sure the engine is running on port 4000."}
      </p>
    </div>
  );
}

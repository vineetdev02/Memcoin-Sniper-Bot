"use client";

import { useFeedStore } from "@/lib/store";
import { formatUptime } from "@/lib/format";
import { Activity, Zap, ShieldOff, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export function Header() {
  const status = useFeedStore((s) => s.status);
  const connected = useFeedStore((s) => s.connected);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isPaper = status?.mode !== "live";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-elevated border border-border">
              <Zap className="h-4 w-4 text-accent-green" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">Sniper</span>
              <span className="hidden sm:block text-[10px] text-fg-subtle">
                Solana memecoin engine
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ModeBadge isPaper={isPaper} />

            <div
              className={`hidden md:flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-2.5 py-1 text-xs ${
                connected ? "text-accent-green" : "text-accent-red"
              }`}
            >
              <span
                className={`relative flex h-1.5 w-1.5 ${
                  connected ? "animate-pulse-fast" : ""
                }`}
              >
                <span
                  className={`absolute inline-flex h-full w-full rounded-full ${
                    connected ? "bg-accent-green" : "bg-accent-red"
                  } opacity-75`}
                />
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                    connected ? "bg-accent-green" : "bg-accent-red"
                  }`}
                />
              </span>
              {connected ? "Engine connected" : "Disconnected"}
            </div>

            {status && (
              <div className="hidden lg:flex items-center gap-3 rounded-md border border-border bg-bg-card px-3 py-1 text-xs text-fg-muted">
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  <span className="text-fg">{status.detectedTotal}</span> pools
                </span>
                <span className="text-fg-dim">·</span>
                <span>up {formatUptime(status.uptime)}</span>
              </div>
            )}
          </div>
        </div>

        {status?.syntheticFeed && (
          <div className="border-t border-accent-amber/20 bg-accent-amber/5 px-1 py-1.5 text-center text-[11px] font-medium text-accent-amber">
            SYNTHETIC FEED ACTIVE — these are fake pools for pipeline testing
          </div>
        )}
      </div>
    </header>
  );
}

function ModeBadge({ isPaper }: { isPaper: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide ${
        isPaper
          ? "border-accent-blue/30 bg-accent-blue/10 text-accent-blue"
          : "border-accent-red/40 bg-accent-red/10 text-accent-red"
      }`}
    >
      {isPaper ? (
        <>
          <ShieldCheck className="h-3.5 w-3.5" />
          PAPER
        </>
      ) : (
        <>
          <ShieldOff className="h-3.5 w-3.5" />
          LIVE
        </>
      )}
    </div>
  );
}

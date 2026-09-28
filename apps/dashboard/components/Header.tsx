"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeedStore } from "@/lib/store";
import { formatUptime } from "@/lib/format";
import { getSocket } from "@/lib/socket";
import { Activity, Zap, ShieldOff, ShieldCheck, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/positions", label: "Positions" },
  { href: "/history", label: "History" },
  { href: "/stats", label: "Stats" },
  { href: "/analytics", label: "Analytics" },
  { href: "/filters", label: "Filters" },
  { href: "/backtest", label: "Backtest" },
];

export function Header() {
  const status = useFeedStore((s) => s.status);
  const connected = useFeedStore((s) => s.connected);
  const openPositions = useFeedStore((s) => s.openPositions);
  const pathname = usePathname();
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isPaper = status?.mode !== "live";
  const openCount = openPositions.size;

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

            <nav className="ml-2 flex items-center gap-0.5 rounded-md border border-border bg-bg-card p-0.5">
              {NAV.map((n) => {
                const active = pathname === n.href;
                const badge = n.href === "/positions" && openCount > 0 ? openCount : null;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {n.label}
                    {badge !== null && (
                      <span className="rounded bg-accent-green/20 px-1 text-[10px] text-accent-green">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <BotToggle
              on={status?.botOn ?? false}
              feedLive={status?.feedLive ?? false}
              available={connected && status !== null}
              isPaper={isPaper}
            />
            {status && (
              <div
                className="hidden md:flex items-center rounded-md border border-border bg-bg-card px-2.5 py-1 text-xs text-fg-muted tabular-nums"
                title={`${status.rpcRequests} RPC requests (≈ Helius credits) and ${status.logNotifications} log notifications since the engine started`}
              >
                RPC <span className="ml-1 text-fg">{status.rpcRequests}</span>
              </div>
            )}
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

            {status?.activePreset && (
              <div className="hidden md:flex items-center gap-1 rounded-md border border-accent-blue/30 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue font-medium">
                preset: {status.activePreset}
              </div>
            )}

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

/**
 * The whole bot: the engine boots off, with no RPC subscription, so nothing is
 * detected, filtered or traded — and no credit is spent — until this is pressed.
 * Off again stops all of that; open positions keep their exits.
 */
function BotToggle({
  on,
  feedLive,
  available,
  isPaper,
}: {
  on: boolean;
  feedLive: boolean;
  available: boolean;
  isPaper: boolean;
}) {
  const [pending, setPending] = useState(false);

  const toggle = () => {
    const next = !on;
    if (next && !isPaper && !window.confirm("Start the bot in LIVE mode? It will spend real SOL.")) return;
    setPending(true);
    getSocket()
      .timeout(10_000)
      .emit("bot:set", next, (err, res) => {
        setPending(false);
        if (err) window.alert("Engine did not answer — the bot is unchanged.");
        else if (!res.ok) window.alert(`Could not switch the bot: ${res.error ?? "unknown error"}`);
      });
  };

  const label = !on ? "Bot OFF" : feedLive ? "Bot ON" : "Bot ON · no feed";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!available || pending}
      title={
        !available
          ? "Engine not connected"
          : on
            ? "Stop: unsubscribe from the RPC provider and open no new positions (open ones keep their exits)"
            : "Start: subscribe to new pools (spends RPC credits), filter them and paper-trade the snipes"
      }
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        !on
          ? "border-border bg-bg-card text-fg-muted hover:text-fg"
          : feedLive
            ? "border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
            : "border-accent-amber/40 bg-accent-amber/10 text-accent-amber"
      }`}
    >
      {on ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {pending ? "…" : label}
    </button>
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeedStore } from "@/lib/store";
import { formatUptime } from "@/lib/format";
import { getSocket, type SystemStatus } from "@/lib/socket";
import {
  Activity,
  Menu,
  Play,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/positions", label: "Positions" },
  { href: "/history", label: "History" },
  { href: "/stats", label: "Stats" },
  { href: "/analytics", label: "Analytics" },
  { href: "/filters", label: "Filters" },
  { href: "/backtest", label: "Backtest" },
];

// Every pill keeps to one line and its own width; what does not fit at a
// breakpoint is hidden there and shown in the menu instead of wrapping.
const PILL = "flex shrink-0 items-center whitespace-nowrap rounded-md border px-2.5 py-1 text-xs";

/**
 * One row at every width. What is always there: the bot switch and the
 * PAPER/LIVE badge — the two things that must never be out of reach or out of
 * sight. Below lg the page links move into a menu, and the lower-priority
 * pills appear as the screen widens: RPC (sm), preset (xl), pools and uptime
 * (2xl). The menu carries all of it at any width.
 */
export function Header() {
  const status = useFeedStore((s) => s.status);
  const connected = useFeedStore((s) => s.connected);
  const openPositions = useFeedStore((s) => s.openPositions);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // a link was followed: the menu has done its job
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const isPaper = status?.mode !== "live";
  const openCount = openPositions.size;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 2xl:max-w-screen-2xl">
        <div className="flex h-14 items-center gap-2 sm:gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Sniper — Live">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-elevated">
              <Zap className="h-4 w-4 text-accent-green" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">Sniper</span>
              <span className="hidden whitespace-nowrap text-[10px] text-fg-subtle 2xl:block">
                Solana memecoin engine
              </span>
            </div>
          </Link>

          <nav
            aria-label="Main"
            className="ml-1 hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg-card p-0.5 lg:flex"
          >
            {NAV.map((n) => (
              <NavLink key={n.href} {...n} active={pathname === n.href} openCount={openCount} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <BotToggle
              on={status?.botOn ?? false}
              feedLive={status?.feedLive ?? false}
              available={connected && status !== null}
              isPaper={isPaper}
            />
            {status && (
              <div
                className={`${PILL} hidden border-border bg-bg-card tabular-nums text-fg-muted sm:flex`}
                title={`${status.rpcRequests} RPC requests (≈ Helius credits) and ${status.logNotifications} log notifications since the engine started`}
              >
                RPC <span className="ml-1 text-fg">{status.rpcRequests}</span>
              </div>
            )}
            <ModeBadge isPaper={isPaper} />
            <Connection connected={connected} />
            {status?.activePreset && (
              <div
                className={`${PILL} hidden max-w-[10rem] gap-1.5 border-accent-blue/30 bg-accent-blue/5 font-medium text-accent-blue xl:flex`}
                title={`Active filter preset: ${status.activePreset}`}
              >
                <SlidersHorizontal className="h-3 w-3 shrink-0" />
                <span className="truncate">{status.activePreset}</span>
              </div>
            )}
            {status && (
              <div className={`${PILL} hidden gap-3 border-border bg-bg-card text-fg-muted 2xl:flex`}>
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  <span className="text-fg">{status.detectedTotal}</span> pools
                </span>
                <span className="text-fg-dim">·</span>
                <span>up {formatUptime(status.uptime)}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="header-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-card text-fg-muted transition-colors hover:text-fg lg:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id="header-menu" className="border-t border-border pb-4 pt-3 lg:hidden">
            <nav aria-label="Main" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {NAV.map((n) => (
                <NavLink key={n.href} {...n} active={pathname === n.href} openCount={openCount} large />
              ))}
            </nav>
            <MenuStatus status={status} connected={connected} />
          </div>
        )}

        {status?.syntheticFeed && (
          <div className="border-t border-accent-amber/20 bg-accent-amber/5 px-1 py-1.5 text-center text-[11px] font-medium text-accent-amber">
            SYNTHETIC FEED ACTIVE — these are fake pools for pipeline testing
          </div>
        )}
      </div>
    </header>
  );
}

function NavLink({
  href,
  label,
  active,
  openCount,
  large = false,
}: {
  href: string;
  label: string;
  active: boolean;
  openCount: number;
  large?: boolean;
}) {
  const badge = href === "/positions" && openCount > 0 ? openCount : null;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors ${
        large ? "px-3 py-2.5 text-sm" : "px-2.5 py-1 text-xs"
      } ${active ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated/60 hover:text-fg"}`}
    >
      {label}
      {badge !== null && (
        <span className="rounded bg-accent-green/20 px-1 text-[10px] text-accent-green">{badge}</span>
      )}
    </Link>
  );
}

/** What the header row hides at narrow widths, laid out in the menu. */
function MenuStatus({ status, connected }: { status: SystemStatus | null; connected: boolean }) {
  const rows: [string, ReactNode][] = [
    ["Engine", connected ? "connected" : "disconnected"],
    ["Preset", status?.activePreset ?? "env defaults"],
    ["Pools seen", status ? status.detectedTotal : "—"],
    ["Uptime", status ? formatUptime(status.uptime) : "—"],
    ["RPC requests", status ? status.rpcRequests : "—"],
  ];
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-bg-card p-3 text-xs sm:grid-cols-5">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-fg-subtle">{k}</dt>
          <dd className="truncate text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Connection({ connected }: { connected: boolean }) {
  const tone = connected ? "text-accent-green" : "text-accent-red";
  const dot = connected ? "bg-accent-green" : "bg-accent-red";
  return (
    <div
      className={`${PILL} gap-1.5 border-border bg-bg-card px-2 ${tone}`}
      title={connected ? "Engine connected" : "Engine disconnected"}
    >
      <span className={`relative flex h-1.5 w-1.5 ${connected ? "animate-pulse-fast" : ""}`}>
        <span className={`absolute inline-flex h-full w-full rounded-full ${dot} opacity-75`} />
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
      </span>
      <span className="hidden xl:inline">{connected ? "Connected" : "Offline"}</span>
      <span className="sr-only xl:hidden">{connected ? "Engine connected" : "Engine disconnected"}</span>
    </div>
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

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!available || pending}
      title={
        !available
          ? "Engine not connected"
          : on
            ? feedLive
              ? "Stop: unsubscribe from the RPC provider and open no new positions (open ones keep their exits)"
              : "On, but no feed is delivering pools — check the RPC settings"
            : "Start: subscribe to new pools (spends RPC credits), filter them and paper-trade the snipes"
      }
      className={`${PILL} gap-1.5 font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        !on
          ? "border-border bg-bg-card text-fg-muted hover:text-fg"
          : feedLive
            ? "border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
            : "border-accent-amber/40 bg-accent-amber/10 text-accent-amber"
      }`}
    >
      {on ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {pending ? (
        "…"
      ) : (
        <>
          {on ? "Bot ON" : "Bot OFF"}
          {on && !feedLive && <span className="hidden sm:inline"> · no feed</span>}
        </>
      )}
    </button>
  );
}

function ModeBadge({ isPaper }: { isPaper: boolean }) {
  return (
    <div
      className={`${PILL} gap-1.5 font-semibold tracking-wide ${
        isPaper
          ? "border-accent-blue/30 bg-accent-blue/10 text-accent-blue"
          : "border-accent-red/40 bg-accent-red/10 text-accent-red"
      }`}
    >
      {isPaper ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
      {isPaper ? "PAPER" : "LIVE"}
    </div>
  );
}

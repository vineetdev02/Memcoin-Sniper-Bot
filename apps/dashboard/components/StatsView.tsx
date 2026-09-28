"use client";

import { useEffect, useState, useCallback } from "react";
import type { StatsWindowKey, TradeStatsWindow, BucketPerformance, TradeHighlight } from "@sniperbot/shared";
import { getSocket } from "@/lib/socket";
import { formatUsd, shortAddress } from "@/lib/format";
import {
  ArrowDownToLine,
  TrendingUp,
  TrendingDown,
  Wallet,
  Target,
  ArrowUpFromLine,
  Trophy,
  Skull,
  Coins,
  LayersIcon,
  RefreshCw,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

const WINDOWS: { key: StatsWindowKey; label: string }[] = [
  { key: "10m", label: "10m" },
  { key: "30m", label: "30m" },
  { key: "1h", label: "1h" },
  { key: "6h", label: "6h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "all", label: "All time" },
];

export function StatsView() {
  const [windowKey, setWindowKey] = useState<StatsWindowKey>("1h");
  const [stats, setStats] = useState<TradeStatsWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    getSocket().emit("stats:get", windowKey, (res) => {
      setLoading(false);
      if (res.ok && res.stats) {
        setStats(res.stats);
      } else {
        setErr(res.error ?? "Failed to load stats");
      }
    });
  }, [windowKey]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {/* Window selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Trade Stats</h1>
          <p className="text-xs text-fg-subtle">
            Performance over a chosen time window — only closed positions count.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-bg-card p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowKey(w.key)}
                className={`rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                  windowKey === w.key
                    ? "bg-bg-elevated text-fg"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-2.5 py-1 text-xs text-fg-muted hover:text-fg"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
          {err}
        </div>
      )}

      {!stats && !err && (
        <div className="rounded-lg border border-border bg-bg-card px-4 py-12 text-center text-sm text-fg-muted">
          Loading stats…
        </div>
      )}

      {stats && <StatsBody stats={stats} />}
    </div>
  );
}

function StatsBody({ stats }: { stats: TradeStatsWindow }) {
  const empty = stats.positionsClosedInWindow === 0;
  const realizedPositive = stats.realizedPnlUsd >= 0;

  return (
    <div className="flex flex-col gap-4">
      <WindowSummary stats={stats} />

      {empty ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-12 text-center text-sm text-fg-muted">
          No positions closed in this window yet.
          <div className="mt-2 text-xs text-fg-subtle">
            Opened in window: {stats.positionsOpenedInWindow}
          </div>
        </div>
      ) : (
        <>
          {/* Money flow */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            <Card
              label="Invested"
              value={formatUsd(stats.investedUsd, { compact: true })}
              sub={`${stats.positionsClosedInWindow} closed`}
              icon={ArrowDownToLine}
              tone="text-accent-blue"
            />
            <Card
              label="Won"
              value={`+${formatUsd(stats.totalGrossWinUsd, { compact: true })}`}
              sub={`${stats.wins} winning trades`}
              icon={TrendingUp}
              tone="text-accent-green"
              ring="border-accent-green/30"
            />
            <Card
              label="Lost"
              value={`-${formatUsd(stats.totalGrossLossUsd, { compact: true })}`}
              sub={`${stats.losses} losing trades`}
              icon={TrendingDown}
              tone="text-accent-red"
              ring="border-accent-red/30"
            />
            <Card
              label="Net P&L"
              value={`${realizedPositive ? "+" : ""}${formatUsd(stats.realizedPnlUsd, { compact: true })}`}
              sub={`ROI ${stats.roiPct >= 0 ? "+" : ""}${stats.roiPct.toFixed(1)}%`}
              icon={Wallet}
              tone={realizedPositive ? "text-accent-green" : "text-accent-red"}
              ring={realizedPositive ? "border-accent-green/40" : "border-accent-red/40"}
            />
            <Card
              label="Opened"
              value={`${stats.positionsOpenedInWindow}`}
              sub="positions in window"
              icon={LayersIcon}
              tone="text-fg-muted"
            />
            <Card
              label="Started"
              value={formatUsd(10_000, { compact: true })}
              sub="paper bankroll basis"
              icon={Coins}
              tone="text-fg-muted"
            />
          </div>

          {/* Performance row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-lg border border-border-subtle bg-bg-card/40 px-3 py-2">
            <PerfPill label="Win rate" value={`${stats.winRatePct.toFixed(0)}%`} icon={Target} tone={stats.winRatePct >= 30 ? "text-accent-green" : "text-fg-muted"} />
            <PerfPill
              label="Profit factor"
              value={
                stats.profitFactor === Infinity || stats.profitFactor > 99
                  ? "∞"
                  : stats.profitFactor > 0
                    ? stats.profitFactor.toFixed(2)
                    : "—"
              }
              icon={ArrowUpFromLine}
              tone={stats.profitFactor >= 1.5 ? "text-accent-green" : stats.profitFactor > 0 ? "text-accent-amber" : "text-fg-muted"}
            />
            <PerfPill label="Avg win" value={stats.avgWinPct ? `+${stats.avgWinPct.toFixed(0)}%` : "—"} icon={ChevronUp} tone="text-accent-green" />
            <PerfPill label="Avg loss" value={stats.avgLossPct ? `${stats.avgLossPct.toFixed(0)}%` : "—"} icon={ChevronDown} tone="text-accent-red" />
            <PerfPill label="ROI" value={`${stats.roiPct >= 0 ? "+" : ""}${stats.roiPct.toFixed(1)}%`} icon={Wallet} tone={stats.roiPct >= 0 ? "text-accent-green" : "text-accent-red"} />
          </div>

          {/* Bankroll chart */}
          {stats.bankrollSeries.length >= 2 && (
            <BankrollChart series={stats.bankrollSeries} />
          )}

          {/* Highlights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <HighlightCard label="Top winner" hl={stats.topWinner} positive />
            <HighlightCard label="Top loser" hl={stats.topLoser} positive={false} />
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <BreakdownTable title="By DEX source" buckets={stats.byDex} />
            <BreakdownTable title="By close reason" buckets={stats.byCloseReason} />
          </div>
        </>
      )}
    </div>
  );
}

function WindowSummary({ stats }: { stats: TradeStatsWindow }) {
  const from = stats.windowMs === 0 ? "since first trade" : new Date(stats.fromTs).toLocaleString();
  const to = new Date(stats.toTs).toLocaleString();
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card/40 px-3 py-2 text-[11px] text-fg-subtle flex flex-wrap gap-3">
      <span>
        Window: <span className="text-fg">{stats.windowKey}</span>
      </span>
      <span>
        From <span className="text-fg-muted">{from}</span>
      </span>
      <span>
        To <span className="text-fg-muted">{to}</span>
      </span>
      <span>
        Computed <span className="text-fg-muted">{new Date(stats.takenAt).toLocaleTimeString()}</span>
      </span>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  ring = "border-border",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Wallet;
  tone: string;
  ring?: string;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border bg-bg-card px-3 py-2.5 ${ring}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-elevated">
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle truncate">
          {label}
        </span>
        <span className={`text-base font-semibold tabular-nums ${tone}`}>{value}</span>
        {sub && (
          <span className="text-[10px] text-fg-subtle truncate tabular-nums">{sub}</span>
        )}
      </div>
    </div>
  );
}

function PerfPill({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-3.5 w-3.5 ${tone}`} />
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
      </div>
    </div>
  );
}

function HighlightCard({
  label,
  hl,
  positive,
}: {
  label: string;
  hl: TradeHighlight | null;
  positive: boolean;
}) {
  const tone = positive ? "text-accent-green" : "text-accent-red";
  const Icon = positive ? Trophy : Skull;
  if (!hl) {
    return (
      <div className="rounded-lg border border-border bg-bg-card px-3 py-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-subtle">
          <Icon className={`h-3.5 w-3.5 ${tone}`} />
          {label}
        </div>
        <div className="mt-2 text-sm text-fg-muted">No {positive ? "winner" : "loser"} in this window</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-subtle">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className={`text-2xl font-semibold tabular-nums ${tone}`}>
          {hl.realizedPnlUsd >= 0 ? "+" : ""}
          {formatUsd(hl.realizedPnlUsd)}
        </span>
        <span className={`text-sm tabular-nums ${tone}`}>
          ({hl.realizedPnlPct >= 0 ? "+" : ""}
          {hl.realizedPnlPct.toFixed(0)}%)
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <Info label="Mint" value={shortAddress(hl.tokenMint, 6)} mono />
        <Info label="DEX" value={hl.source} />
        <Info label="Entry size" value={formatUsd(hl.entrySizeUsd)} />
        <Info label="Peak gain" value={`+${hl.peakGainPct.toFixed(0)}%`} />
        <Info label="Closed via" value={hl.closeReason ?? "—"} />
        <Info label="Closed at" value={new Date(hl.closedAt).toLocaleTimeString()} />
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</span>
      <span className={`text-fg ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function BreakdownTable({ title, buckets }: { title: string; buckets: BucketPerformance[] }) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card px-3 py-3">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{title}</div>
        <div className="mt-2 text-sm text-fg-muted">No data</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-bg-card">
      <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-fg-subtle">
        {title}
      </div>
      <table className="w-full text-xs">
        <thead className="text-left text-fg-subtle">
          <tr>
            <th className="px-3 py-1.5 font-medium">Label</th>
            <th className="px-3 py-1.5 font-medium text-right">Trades</th>
            <th className="px-3 py-1.5 font-medium text-right">Win %</th>
            <th className="px-3 py-1.5 font-medium text-right">Net P&L</th>
          </tr>
        </thead>
        <tbody className="text-fg">
          {buckets.map((b) => (
            <tr key={b.label} className="border-t border-border-subtle">
              <td className="px-3 py-1.5">{b.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{b.trades}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                <span className={b.winRatePct >= 30 ? "text-accent-green" : "text-fg-muted"}>
                  {b.winRatePct.toFixed(0)}%
                </span>
              </td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${
                  b.netPnlUsd >= 0 ? "text-accent-green" : "text-accent-red"
                }`}
              >
                {b.netPnlUsd >= 0 ? "+" : ""}
                {formatUsd(b.netPnlUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BankrollChart({ series }: { series: { ts: number; balanceUsd: number }[] }) {
  // Simple inline SVG sparkline — no extra deps needed.
  const w = 800;
  const h = 160;
  const padding = 8;
  const xs = series.map((p) => p.ts);
  const ys = series.map((p) => p.balanceUsd);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = Math.max(1, xMax - xMin);
  const yRange = Math.max(0.0001, yMax - yMin);
  const points = series.map((p) => {
    const x = padding + ((p.ts - xMin) / xRange) * (w - padding * 2);
    const y = h - padding - ((p.balanceUsd - yMin) / yRange) * (h - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(" L ")}`;
  const last = series[series.length - 1];
  const first = series[0];
  const trendUp = (last?.balanceUsd ?? 0) >= (first?.balanceUsd ?? 0);
  const stroke = trendUp ? "#22c55e" : "#ef4444";
  const fill = trendUp ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)";
  const areaPath =
    `M ${padding},${h - padding} ` +
    `L ${points.join(" L ")} ` +
    `L ${w - padding},${h - padding} Z`;

  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          Bankroll over window
        </div>
        <div className="text-xs tabular-nums text-fg-muted">
          {formatUsd(yMin, { compact: true })} → {formatUsd(yMax, { compact: true })}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" preserveAspectRatio="none">
        <path d={areaPath} fill={fill} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

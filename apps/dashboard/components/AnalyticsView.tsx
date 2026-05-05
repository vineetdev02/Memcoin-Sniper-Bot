"use client";

import { useCallback, useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import { formatUsd } from "@/lib/format";
import { FILTER_LABELS, type AnalyticsSnapshot, type BucketPerformance } from "@sniperbot/shared";
import { RefreshCw } from "lucide-react";

export function AnalyticsView() {
  const [snap, setSnap] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    const socket = getSocket();
    const timeout = setTimeout(() => {
      setErr("timed out waiting for engine");
      setLoading(false);
    }, 8000);
    socket.emit("analytics:get", (s) => {
      clearTimeout(timeout);
      setSnap(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Filter analytics</h1>
        <div className="flex items-center gap-2">
          {snap && (
            <span className="text-xs text-fg-subtle">
              {snap.totalClosed} closed positions ·
              baseline win rate {snap.baselineWinRatePct.toFixed(1)}%
            </span>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-border bg-bg-card px-2 py-1 text-xs hover:bg-bg-elevated disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 p-4 text-sm text-accent-red">
          {err}
        </div>
      )}

      {!snap && !err ? (
        <SkeletonCard />
      ) : snap && snap.totalClosed === 0 ? (
        <div className="rounded-lg border border-border bg-bg-card p-12 text-center text-sm text-fg-muted">
          No closed positions yet — analytics need at least a handful of trades to be meaningful.
        </div>
      ) : (
        snap && (
          <>
            <SummaryCards snap={snap} />
            <FilterPerfTable snap={snap} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BucketCard title="By DEX source" buckets={snap.byDex} />
              <BucketCard title="By initial liquidity" buckets={snap.byLiquidity} />
              <BucketCard title="By filter score bucket" buckets={snap.byScoreBucket} />
              <BucketCard
                title="By hour of day (UTC)"
                buckets={snap.byHour.filter((b) => b.trades > 0)}
              />
            </div>
          </>
        )
      )}
    </div>
  );
}

function SummaryCards({ snap }: { snap: AnalyticsSnapshot }) {
  const pf = Number.isFinite(snap.profitFactor) ? snap.profitFactor.toFixed(2) : "∞";
  const pnlPositive = snap.netPnlUsd >= 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Closed positions" value={String(snap.totalClosed)} tone="default" />
      <Stat
        label="Net P&L"
        value={`${pnlPositive ? "+" : ""}${formatUsd(snap.netPnlUsd)}`}
        tone={pnlPositive ? "good" : "bad"}
      />
      <Stat label="Win rate" value={`${snap.baselineWinRatePct.toFixed(1)}%`} tone="default" />
      <Stat label="Profit factor" value={pf} tone={snap.profitFactor >= 1 ? "good" : "bad"} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "default" }) {
  const toneCls =
    tone === "good" ? "text-accent-green" : tone === "bad" ? "text-accent-red" : "text-fg";
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function FilterPerfTable({ snap }: { snap: AnalyticsSnapshot }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
      <table className="w-full text-xs">
        <thead className="bg-bg-elevated text-[10px] uppercase tracking-wider text-fg-subtle">
          <tr>
            <th className="px-3 py-2 text-left">Filter</th>
            <th className="px-3 py-2 text-right">Trades passed</th>
            <th className="px-3 py-2 text-right">W/L</th>
            <th className="px-3 py-2 text-right">Win rate</th>
            <th className="px-3 py-2 text-right">Lift vs baseline</th>
            <th className="px-3 py-2 text-right">Net P&L</th>
            <th className="px-3 py-2 text-right">Avg P&L</th>
            <th className="px-3 py-2 text-right">Pools rejected</th>
          </tr>
        </thead>
        <tbody>
          {snap.filterPerformance.map((f) => (
            <tr key={f.filterId} className="border-t border-border hover:bg-bg-elevated/50">
              <td className="px-3 py-2 font-medium">{FILTER_LABELS[f.filterId] ?? f.filterId}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.passedTrades}</td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                {f.passedWins}/{f.passedLosses}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {f.passedTrades > 0 ? `${f.passedWinRatePct.toFixed(1)}%` : "—"}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  f.liftPct > 0 ? "text-accent-green" : f.liftPct < 0 ? "text-accent-red" : "text-fg-muted"
                }`}
              >
                {f.passedTrades > 0
                  ? `${f.liftPct >= 0 ? "+" : ""}${f.liftPct.toFixed(1)}%`
                  : "—"}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  f.netPnlUsd >= 0 ? "text-accent-green" : "text-accent-red"
                }`}
              >
                {formatUsd(f.netPnlUsd)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                {f.passedTrades > 0 ? formatUsd(f.avgPnlUsd) : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{f.rejected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BucketCard({ title, buckets }: { title: string; buckets: BucketPerformance[] }) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4 text-xs text-fg-muted">
        <div className="text-fg font-medium mb-2">{title}</div>
        <div className="text-center py-6">No data yet</div>
      </div>
    );
  }
  const maxTrades = Math.max(...buckets.map((b) => b.trades));
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4">
      <div className="mb-3 text-sm font-medium">{title}</div>
      <div className="flex flex-col gap-1.5">
        {buckets.map((b) => (
          <div key={b.label} className="grid grid-cols-[80px_1fr_60px_60px] items-center gap-2 text-xs">
            <span className="truncate text-fg-muted">{b.label}</span>
            <div className="relative h-4 rounded bg-bg-elevated overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${
                  b.netPnlUsd >= 0 ? "bg-accent-green/40" : "bg-accent-red/40"
                }`}
                style={{ width: `${maxTrades > 0 ? (b.trades / maxTrades) * 100 : 0}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] tabular-nums text-fg">
                {b.trades}
              </span>
            </div>
            <span className="tabular-nums text-right text-fg-muted">
              {b.winRatePct.toFixed(0)}%
            </span>
            <span
              className={`tabular-nums text-right ${
                b.netPnlUsd >= 0 ? "text-accent-green" : "text-accent-red"
              }`}
            >
              {formatUsd(b.netPnlUsd, { compact: true })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-12 text-center text-sm text-fg-muted">
      Loading analytics from engine…
    </div>
  );
}

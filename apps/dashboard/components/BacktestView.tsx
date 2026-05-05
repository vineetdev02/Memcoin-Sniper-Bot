"use client";

import { useCallback, useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import {
  FILTER_LABELS,
  FILTER_ORDER,
  type BacktestSummary,
  type FilterPreset,
} from "@sniperbot/shared";
import { Play } from "lucide-react";

export function BacktestView() {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(500);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getSocket().emit("presets:list", ({ presets, activeName }) => {
      setPresets(presets);
      if (!selected) setSelected(activeName ?? presets[0]?.name ?? null);
    });
  }, [selected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = () => {
    const preset = presets.find((p) => p.name === selected);
    if (!preset) return;
    setRunning(true);
    setErr(null);
    setSummary(null);
    getSocket().emit(
      "backtest:run",
      { presetName: preset.name, config: preset.config, limit },
      (res) => {
        setRunning(false);
        if (res.ok && res.summary) setSummary(res.summary);
        else setErr(res.error ?? "backtest failed");
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">Backtest</h1>
        <p className="text-xs text-fg-subtle">
          Replays the most recent N persisted pool events through a chosen preset and counts snipes/rejects.
          Live trading is unaffected.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-bg-card p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[10px] uppercase tracking-wider text-fg-subtle">Preset</label>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
                {p.isBuiltIn ? " (built-in)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:w-40">
          <label className="text-[10px] uppercase tracking-wider text-fg-subtle">Pools to replay</label>
          <input
            type="number"
            min={50}
            max={5000}
            step={50}
            value={limit}
            onChange={(e) => setLimit(Math.max(50, Math.min(5000, Number(e.target.value) || 500)))}
            className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm tabular-nums"
          />
        </div>
        <button
          onClick={run}
          disabled={running || !selected}
          className="flex items-center gap-1.5 rounded bg-accent-blue/20 border border-accent-blue/30 text-accent-blue px-4 py-2 text-sm font-medium hover:bg-accent-blue/30 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          {running ? "Running…" : "Run backtest"}
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">
          {err}
        </div>
      )}

      {summary && <SummaryView summary={summary} />}
    </div>
  );
}

function SummaryView({ summary }: { summary: BacktestSummary }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Replayed" value={String(summary.poolsReplayed)} />
        <Stat label="Snipes" value={String(summary.snipes)} tone="good" />
        <Stat label="Rejects" value={String(summary.rejects)} tone="bad" />
        <Stat
          label="Acceptance"
          value={`${summary.acceptanceRatePct.toFixed(1)}%`}
          tone={summary.acceptanceRatePct < 1 ? "bad" : summary.acceptanceRatePct > 25 ? "bad" : "good"}
        />
      </div>

      <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-bg-elevated">
          <span className="text-sm font-medium">Per-filter pass / fail counts</span>
          <span className="ml-2 text-xs text-fg-subtle">
            ran in {summary.totalDurationMs.toLocaleString()} ms
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-bg-elevated/50 text-[10px] uppercase tracking-wider text-fg-subtle">
            <tr>
              <th className="px-3 py-2 text-left">Filter</th>
              <th className="px-3 py-2 text-right">Pass</th>
              <th className="px-3 py-2 text-right">Fail</th>
              <th className="px-3 py-2 text-right">Pass rate</th>
              <th className="px-3 py-2">Distribution</th>
            </tr>
          </thead>
          <tbody>
            {FILTER_ORDER.map((id) => {
              const pass = summary.filterPassCounts[id] ?? 0;
              const fail = summary.filterFailCounts[id] ?? 0;
              const total = pass + fail;
              const rate = total > 0 ? (pass / total) * 100 : 0;
              const widthPct = summary.poolsReplayed > 0 ? (total / summary.poolsReplayed) * 100 : 0;
              return (
                <tr key={id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{FILTER_LABELS[id]}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-accent-green">{pass}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-accent-red">{fail}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total > 0 ? `${rate.toFixed(1)}%` : "—"}</td>
                  <td className="px-3 py-2 w-1/3">
                    <div className="relative h-3 rounded bg-bg-elevated overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-accent-green/40"
                        style={{ width: `${widthPct * (rate / 100)}%` }}
                      />
                      <div
                        className="absolute inset-y-0 bg-accent-red/40"
                        style={{
                          left: `${widthPct * (rate / 100)}%`,
                          width: `${widthPct * (1 - rate / 100)}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const toneCls = tone === "good" ? "text-accent-green" : tone === "bad" ? "text-accent-red" : "text-fg";
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

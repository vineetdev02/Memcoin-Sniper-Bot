"use client";

import { useFeedStore } from "@/lib/store";
import { formatPriceUsd, formatUsd, shortAddress } from "@/lib/format";
import type { ExitReason, Position } from "@sniperbot/shared";

const REASON_LABELS: Record<ExitReason, string> = {
  tp1: "TP1",
  tp2: "TP2",
  tp3: "TP3",
  tp4: "TP4",
  "stop-loss": "SL",
  "trailing-stop": "Trail",
  "time-exit": "Time",
  "rug-pull": "Rug",
  "kill-switch": "Kill",
  manual: "Manual",
};

const REASON_TONE: Record<ExitReason, string> = {
  tp1: "text-accent-green",
  tp2: "text-accent-green",
  tp3: "text-accent-green",
  tp4: "text-accent-green",
  "stop-loss": "text-accent-red",
  "trailing-stop": "text-accent-blue",
  "time-exit": "text-accent-amber",
  "rug-pull": "text-accent-red",
  "kill-switch": "text-fg-muted",
  manual: "text-fg-muted",
};

export function HistoryTable() {
  const closed = useFeedStore((s) => s.closedPositions);

  if (closed.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-12 text-center text-sm text-fg-muted">
        No closed positions yet. Once a position hits its first exit, it will be archived here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-elevated text-[10px] uppercase tracking-wider text-fg-subtle">
          <tr>
            <th className="px-3 py-2 text-left">Token</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="px-3 py-2 text-right">Entry</th>
            <th className="px-3 py-2 text-right">Peak</th>
            <th className="px-3 py-2 text-right">P&L $</th>
            <th className="px-3 py-2 text-right">P&L %</th>
            <th className="px-3 py-2 text-center">Exit</th>
            <th className="px-3 py-2 text-right">Held</th>
          </tr>
        </thead>
        <tbody>
          {closed.map((p) => (
            <ClosedRow key={p.id} position={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosedRow({ position: p }: { position: Position }) {
  const pnlPositive = p.realizedPnlUsd >= 0;
  const pnlPct = (p.realizedPnlUsd / p.entrySizeUsd) * 100;
  const reason = p.closeReason ?? "manual";
  const heldSec = p.closedAt ? Math.floor((p.closedAt - p.openedAt) / 1000) : 0;
  const heldStr =
    heldSec >= 3600
      ? `${(heldSec / 3600).toFixed(1)}h`
      : heldSec >= 60
        ? `${Math.floor(heldSec / 60)}m`
        : `${heldSec}s`;

  return (
    <tr className="border-t border-border hover:bg-bg-elevated/50">
      <td className="px-3 py-2">
        <div className="flex flex-col leading-tight">
          <span className="font-semibold">{p.tokenSymbol ?? "?"}</span>
          <span className="text-[10px] text-fg-subtle">{shortAddress(p.tokenMint)}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-fg-muted">{p.source}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatUsd(p.entrySizeUsd)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
        {formatPriceUsd(p.entryPriceUsd)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">+{p.peakGainPct.toFixed(0)}%</td>
      <td
        className={`px-3 py-2 text-right tabular-nums font-semibold ${
          pnlPositive ? "text-accent-green" : "text-accent-red"
        }`}
      >
        {pnlPositive ? "+" : ""}
        {formatUsd(p.realizedPnlUsd)}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${
          pnlPositive ? "text-accent-green" : "text-accent-red"
        }`}
      >
        {pnlPositive ? "+" : ""}
        {pnlPct.toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium ${REASON_TONE[reason]}`}>
          {REASON_LABELS[reason]}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-fg-muted">{heldStr}</td>
    </tr>
  );
}

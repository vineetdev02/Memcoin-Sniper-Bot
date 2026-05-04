"use client";

import { useFeedStore } from "@/lib/store";
import { formatPriceUsd, formatRelativeTime, formatUsd, shortAddress } from "@/lib/format";
import type { Position } from "@sniperbot/shared";
import { useMemo } from "react";

export function PositionsTable() {
  const openMap = useFeedStore((s) => s.openPositions);
  const positions = useMemo(
    () => Array.from(openMap.values()).sort((a, b) => b.openedAt - a.openedAt),
    [openMap],
  );

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-12 text-center text-sm text-fg-muted">
        No open positions. Snipe verdicts from the live feed will appear here.
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
            <th className="px-3 py-2 text-right">Now</th>
            <th className="px-3 py-2 text-right">P&L</th>
            <th className="px-3 py-2 text-right">Peak</th>
            <th className="px-3 py-2 text-center">TP</th>
            <th className="px-3 py-2 text-center">Trail</th>
            <th className="px-3 py-2 text-right">Age</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <PositionRow key={p.id} position={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionRow({ position: p }: { position: Position }) {
  const pnlPositive = p.unrealizedPnlPct >= 0;
  const peakClass = p.peakGainPct >= 100
    ? "text-accent-green"
    : p.peakGainPct >= 0
      ? "text-fg"
      : "text-fg-muted";
  const tpHit = p.tpLadder.filter((tp) => tp.hit).length;

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
      <td className="px-3 py-2 text-right tabular-nums">
        {formatPriceUsd(p.currentPriceUsd)}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums font-semibold ${
          pnlPositive ? "text-accent-green" : "text-accent-red"
        }`}
      >
        {pnlPositive ? "+" : ""}
        {p.unrealizedPnlPct.toFixed(1)}%
        <div className="text-[10px] font-normal text-fg-subtle">
          {pnlPositive ? "+" : ""}
          {formatUsd(p.unrealizedPnlUsd)}
        </div>
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${peakClass}`}>
        +{p.peakGainPct.toFixed(0)}%
      </td>
      <td className="px-3 py-2 text-center">
        <div className="inline-flex gap-0.5">
          {p.tpLadder.map((tp, i) => (
            <span
              key={i}
              title={`+${tp.gainPct}% sell ${tp.sellPct}%`}
              className={`h-2.5 w-2.5 rounded-sm ${
                tp.hit ? "bg-accent-green" : "bg-bg-elevated border border-border"
              }`}
            />
          ))}
        </div>
        <div className="text-[10px] text-fg-subtle mt-0.5">{tpHit}/{p.tpLadder.length}</div>
      </td>
      <td className="px-3 py-2 text-center">
        {p.trailingStopArmed ? (
          <span className="rounded bg-accent-blue/15 px-1.5 py-0.5 text-[10px] text-accent-blue">
            ARMED
          </span>
        ) : (
          <span className="text-fg-subtle text-[10px]">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-fg-muted">{formatRelativeTime(p.openedAt)}</td>
    </tr>
  );
}

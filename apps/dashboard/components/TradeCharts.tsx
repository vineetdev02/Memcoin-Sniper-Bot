"use client";

import { useState } from "react";
import type { TradePoint } from "@sniperbot/shared";
import { formatUsd, shortAddress } from "@/lib/format";

const GREEN = "#22c55e";
const RED = "#ef4444";

const REASON_LABEL: Record<string, string> = {
  stop_loss: "stop-loss",
  time_exit: "time exit",
  trailing_stop: "trailing stop",
  tp1: "take-profit 1",
  tp2: "take-profit 2",
  tp3: "take-profit 3",
  tp4: "take-profit 4",
  rug_pull: "rug",
  kill_switch: "kill switch",
  manual: "manual",
};

function hold(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function signedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
}

/** What a hover shows for one trade, in either chart. */
function TradeTip({ t }: { t: TradePoint }) {
  return (
    <>
      <div className="text-fg-subtle">
        {new Date(t.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
        <span className="font-mono">{shortAddress(t.tokenMint, 4)}</span>
      </div>
      <div className={`font-medium ${t.pnlUsd > 0 ? "text-accent-green" : t.pnlUsd < 0 ? "text-accent-red" : "text-fg"}`}>
        {t.pnlUsd > 0 ? "+" : ""}
        {formatUsd(t.pnlUsd)} ({signedPct(t.pnlPct)})
      </div>
      <div className="text-fg-muted">
        peak {signedPct(t.peakGainPct)} · {REASON_LABEL[t.reason] ?? t.reason} · held {hold(t.holdSec)}
      </div>
    </>
  );
}

function Frame({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{title}</div>
        <div className="text-[11px] text-fg-subtle">{note}</div>
      </div>
      {children}
    </div>
  );
}

/** One bar per closed trade, in the order they closed: up for a gain, down for a loss. */
export function PnlBars({ trades }: { trades: TradePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 800;
  const h = 160;
  const max = Math.max(1, ...trades.map((t) => Math.abs(t.pnlUsd)));
  const mid = h / 2;
  const slot = w / trades.length;
  const gap = slot > 6 ? 2 : 0;
  const ht = hover !== null ? trades[hover] : undefined;
  const total = trades.reduce((s, t) => s + t.pnlUsd, 0);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * trades.length);
    setHover(Math.min(trades.length - 1, Math.max(0, i)));
  };

  return (
    <Frame title="P&L per trade" note={`${trades.length} trades · net ${total > 0 ? "+" : ""}${formatUsd(total)}`}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="h-56 w-full cursor-crosshair touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={0} x2={w} y1={mid} y2={mid} stroke="currentColor" className="text-border" vectorEffect="non-scaling-stroke" />
          {trades.map((t, i) => {
            const len = Math.max(1, (Math.abs(t.pnlUsd) / max) * (mid - 4));
            return (
              <rect
                key={i}
                x={i * slot + gap / 2}
                width={Math.max(0.5, slot - gap)}
                y={t.pnlUsd >= 0 ? mid - len : mid}
                height={len}
                fill={t.pnlUsd >= 0 ? GREEN : RED}
                opacity={hover === null || hover === i ? 0.9 : 0.35}
              />
            );
          })}
        </svg>
        {ht && hover !== null && (
          <div
            className={`pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-bg-card/95 whitespace-nowrap px-2 py-1 text-xs shadow-lg tabular-nums ${
              (hover + 0.5) / trades.length > 0.5 ? "-translate-x-full -ml-2" : "ml-2"
            }`}
            style={{ left: `${((hover + 0.5) / trades.length) * 100}%` }}
          >
            <TradeTip t={ht} />
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-fg-subtle tabular-nums">
        <span>oldest</span>
        <span>tallest bar {formatUsd(max)}</span>
        <span>newest</span>
      </div>
    </Frame>
  );
}

/**
 * Each trade at its best moment (across) against what it banked (up). A trade
 * on the diagonal sold at its peak; the drop below it is profit given back.
 */
export function PeakVsKept({ trades }: { trades: TradePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const peaks = trades.map((t) => Math.max(0, t.peakGainPct)).sort((a, b) => a - b);
  // the 95th percentile, so one moonshot does not squash every other dot into the corner
  const xMax = Math.max(50, Math.min(1000, peaks[Math.floor(peaks.length * 0.95)] ?? 50) * 1.1);
  const yMax = Math.max(xMax, 10);
  const yMin = -100;
  const x = (v: number) => (Math.min(xMax, Math.max(0, v)) / xMax) * 100;
  const y = (v: number) => (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * 100;
  const givenBack = trades.filter((t) => t.peakGainPct >= 20 && t.pnlPct <= 0).length;
  const ht = hover !== null ? trades[hover] : undefined;

  return (
    <Frame
      title="Peak vs kept"
      note={givenBack > 0 ? `${givenBack} trades were up 20%+ and still closed at a loss` : "how much of each peak was banked"}
    >
      <div className="relative h-56 border-b border-l border-border">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* sold at the peak */}
          <line x1={0} y1={y(0)} x2={x(xMax)} y2={y(xMax)} stroke="currentColor" className="text-fg-subtle" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {/* break-even */}
          <line x1={0} x2={100} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-border" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute right-1 text-[10px] text-fg-subtle" style={{ top: `calc(${y(xMax)}% + 2px)` }}>
          sold at the peak
        </span>
        <span className="absolute right-1 text-[10px] text-fg-subtle" style={{ top: `calc(${y(0)}% + 2px)` }}>
          break-even
        </span>
        <span className="absolute left-1 top-0.5 text-[10px] text-fg-subtle">kept {signedPct(yMax)}</span>
        <span className="absolute bottom-0.5 left-1 text-[10px] text-fg-subtle">kept -100%</span>
        {trades.map((t, i) => (
          <button
            key={i}
            type="button"
            aria-label={`trade ${i + 1}: peak ${signedPct(t.peakGainPct)}, kept ${signedPct(t.pnlPct)}`}
            className="absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${x(t.peakGainPct)}%`, top: `${y(t.pnlPct)}%` }}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <span
              className="block h-2.5 w-2.5 rounded-full border-2 border-bg-card"
              style={{ background: t.pnlUsd > 0 ? GREEN : RED, opacity: hover === null || hover === i ? 1 : 0.4 }}
            />
          </button>
        ))}
        {ht && hover !== null && (
          <div
            className={`pointer-events-none absolute z-10 rounded-md border border-border bg-bg-card/95 whitespace-nowrap px-2 py-1 text-xs shadow-lg tabular-nums ${
              x(ht.peakGainPct) > 50 ? "-translate-x-full -ml-3" : "ml-3"
            }`}
            style={{ left: `${x(ht.peakGainPct)}%`, top: `${Math.min(80, y(ht.pnlPct))}%` }}
          >
            <TradeTip t={ht} />
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-fg-subtle tabular-nums">
        <span>peak 0%</span>
        <span>best moment of the trade →</span>
        <span>{signedPct(xMax)}</span>
      </div>
    </Frame>
  );
}

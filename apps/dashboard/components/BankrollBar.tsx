"use client";

import { useFeedStore } from "@/lib/store";
import { formatUsd } from "@/lib/format";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Target,
  LayersIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
} from "lucide-react";

export function BankrollBar() {
  const bankroll = useFeedStore((s) => s.bankroll);
  const status = useFeedStore((s) => s.status);
  const openCount = useFeedStore((s) => s.openPositions.size);

  if (!bankroll) {
    return (
      <div className="rounded-lg border border-border bg-bg-card px-4 py-3 text-sm text-fg-muted">
        Loading bankroll…
      </div>
    );
  }

  const realized = bankroll.realizedPnlUsd;
  const realizedPositive = realized >= 0;
  const unrealizedPositive = bankroll.unrealizedPnlUsd >= 0;
  const wonUsd = bankroll.totalGrossWinUsd ?? 0;
  const lostUsd = bankroll.totalGrossLossUsd ?? 0;
  const investedUsd = bankroll.totalInvestedUsd ?? 0;
  const startUsd = bankroll.startingBalanceUsd ?? 0;

  // PRIMARY row — the "money flow" picture
  const moneyCards = [
    {
      label: "Started with",
      value: formatUsd(startUsd, { compact: true }),
      sub: "initial bankroll",
      icon: Coins,
      tone: "text-fg-muted",
      ring: "border-border",
    },
    {
      label: "Invested",
      value: formatUsd(investedUsd, { compact: true }),
      sub: `${bankroll.totalTrades + openCount} positions opened`,
      icon: ArrowDownToLine,
      tone: "text-accent-blue",
      ring: "border-border",
    },
    {
      label: "Won",
      value: `+${formatUsd(wonUsd, { compact: true })}`,
      sub: `${bankroll.wins} winning trades`,
      icon: TrendingUp,
      tone: "text-accent-green",
      ring: "border-accent-green/30",
    },
    {
      label: "Lost",
      value: `-${formatUsd(lostUsd, { compact: true })}`,
      sub: `${bankroll.losses} losing trades`,
      icon: TrendingDown,
      tone: "text-accent-red",
      ring: "border-accent-red/30",
    },
    {
      label: "Bankroll now",
      value: formatUsd(bankroll.balanceUsd, { compact: true }),
      sub: `${realizedPositive ? "+" : ""}${formatUsd(realized, { compact: true })} realized`,
      icon: Wallet,
      tone: realizedPositive ? "text-accent-green" : "text-accent-red",
      ring: realizedPositive ? "border-accent-green/40" : "border-accent-red/40",
    },
    {
      label: "Open positions",
      value: `${openCount}`,
      sub: `${unrealizedPositive ? "+" : ""}${formatUsd(bankroll.unrealizedPnlUsd, { compact: true })} unrealized`,
      icon: LayersIcon,
      tone: openCount > 0 ? "text-accent-blue" : "text-fg-muted",
      ring: "border-border",
    },
  ];

  // SECONDARY row — performance quality
  const winRate = bankroll.totalTrades > 0 ? bankroll.winRatePct : null;
  const pf = bankroll.profitFactor;
  const avgWin = bankroll.avgWinPct;
  const avgLoss = bankroll.avgLossPct;
  const roiPct = startUsd > 0 ? (realized / startUsd) * 100 : 0;

  const perfCards = [
    {
      label: "Win rate",
      value: winRate !== null ? `${winRate.toFixed(0)}%` : "—",
      icon: Target,
      tone: winRate !== null && winRate >= 30 ? "text-accent-green" : "text-fg-muted",
    },
    {
      label: "Profit factor",
      value:
        pf === Infinity
          ? "∞"
          : pf > 0
            ? pf.toFixed(2)
            : "—",
      icon: ArrowUpFromLine,
      tone: pf >= 1.5 ? "text-accent-green" : pf > 0 ? "text-accent-amber" : "text-fg-muted",
    },
    {
      label: "Avg win",
      value: avgWin ? `+${avgWin.toFixed(0)}%` : "—",
      icon: TrendingUp,
      tone: "text-accent-green",
    },
    {
      label: "Avg loss",
      value: avgLoss ? `${avgLoss.toFixed(0)}%` : "—",
      icon: TrendingDown,
      tone: "text-accent-red",
    },
    {
      label: "ROI",
      value: startUsd > 0 ? `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(1)}%` : "—",
      icon: Wallet,
      tone: roiPct >= 0 ? "text-accent-green" : "text-accent-red",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Money flow — what user actually cares about */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {moneyCards.map((c) => (
          <div
            key={c.label}
            className={`flex items-start gap-3 rounded-lg border bg-bg-card px-3 py-2.5 ${c.ring}`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-elevated">
              <c.icon className={`h-4 w-4 ${c.tone}`} />
            </div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-fg-subtle truncate">
                {c.label}
              </span>
              <span className={`text-base font-semibold tabular-nums ${c.tone}`}>
                {c.value}
              </span>
              {c.sub && (
                <span className="text-[10px] text-fg-subtle truncate tabular-nums">
                  {c.sub}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Performance row — secondary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-lg border border-border-subtle bg-bg-card/40 px-3 py-2">
        {perfCards.map((c) => (
          <div key={c.label} className="flex items-center gap-2">
            <c.icon className={`h-3.5 w-3.5 ${c.tone}`} />
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                {c.label}
              </span>
              <span className={`text-sm font-semibold tabular-nums ${c.tone}`}>
                {c.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      {status?.syntheticFeed && (
        <div className="rounded-md border border-accent-amber/20 bg-accent-amber/5 px-3 py-1.5 text-[11px] text-accent-amber">
          Paper P&amp;L is being driven by the synthetic price simulator (30× time scale). Bucket
          quality from the synthetic feed shapes each trajectory.
        </div>
      )}
    </div>
  );
}

"use client";

import { useFeedStore } from "@/lib/store";
import { formatUsd } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, Target, BarChart3, LayersIcon } from "lucide-react";

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

  const cards = [
    {
      label: "Bankroll",
      value: formatUsd(bankroll.balanceUsd, { compact: true }),
      icon: Wallet,
      tone: "text-fg",
      ring: "border-border",
    },
    {
      label: "Realized P&L",
      value: `${realizedPositive ? "+" : ""}${formatUsd(realized, { compact: true })}`,
      icon: realizedPositive ? TrendingUp : TrendingDown,
      tone: realizedPositive ? "text-accent-green" : "text-accent-red",
      ring: realizedPositive ? "border-accent-green/30" : "border-accent-red/30",
    },
    {
      label: "Unrealized",
      value: `${unrealizedPositive ? "+" : ""}${formatUsd(bankroll.unrealizedPnlUsd, { compact: true })}`,
      icon: BarChart3,
      tone: unrealizedPositive ? "text-accent-green" : "text-accent-red",
      ring: "border-border",
    },
    {
      label: "Open",
      value: `${openCount}`,
      icon: LayersIcon,
      tone: openCount > 0 ? "text-accent-blue" : "text-fg-muted",
      ring: "border-border",
    },
    {
      label: "Win rate",
      value: bankroll.totalTrades > 0
        ? `${bankroll.winRatePct.toFixed(0)}%`
        : "—",
      icon: Target,
      tone: bankroll.winRatePct >= 30 ? "text-accent-green" : "text-fg-muted",
      ring: "border-border",
    },
    {
      label: "PF",
      value: bankroll.profitFactor === Infinity
        ? "∞"
        : bankroll.profitFactor > 0
          ? bankroll.profitFactor.toFixed(2)
          : "—",
      icon: BarChart3,
      tone: bankroll.profitFactor >= 1.5 ? "text-accent-green" : "text-fg-muted",
      ring: "border-border",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`flex items-center gap-3 rounded-lg border bg-bg-card px-3 py-2.5 ${c.ring}`}
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
          </div>
        </div>
      ))}
      {status?.syntheticFeed && (
        <div className="col-span-2 sm:col-span-3 lg:col-span-6 rounded-md border border-accent-amber/20 bg-accent-amber/5 px-3 py-1.5 text-[11px] text-accent-amber">
          Paper PnL is being driven by the synthetic price simulator (30× time scale). Bucket
          quality from the synthetic feed shapes each trajectory.
        </div>
      )}
    </div>
  );
}

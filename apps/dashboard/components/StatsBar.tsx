"use client";

import { useFeedStore } from "@/lib/store";
import { formatUptime } from "@/lib/format";
import { Activity, Ban, Crosshair, Filter as FilterIcon, Inbox, Timer } from "lucide-react";

export function StatsBar() {
  const status = useFeedStore((s) => s.status);
  const poolCount = useFeedStore((s) => s.pools.length);

  const total = (status?.snipes ?? 0) + (status?.rejects ?? 0);
  const snipeRate = total > 0 ? `${Math.round(((status?.snipes ?? 0) / total) * 100)}%` : "—";

  const stats = [
    {
      label: "Detected",
      value: status?.detectedTotal ?? 0,
      icon: Activity,
      tone: "text-fg",
      ring: "border-border",
    },
    {
      label: "Snipe",
      value: status?.snipes ?? 0,
      icon: Crosshair,
      tone: "text-accent-green",
      ring: "border-accent-green/30",
    },
    {
      label: "Reject",
      value: status?.rejects ?? 0,
      icon: Ban,
      tone: "text-accent-red",
      ring: "border-accent-red/30",
    },
    {
      label: "Pass rate",
      value: snipeRate,
      icon: FilterIcon,
      tone: "text-accent-blue",
      ring: "border-accent-blue/30",
    },
    {
      label: "In feed",
      value: poolCount,
      icon: Inbox,
      tone: "text-fg-muted",
      ring: "border-border",
    },
    {
      label: "Uptime",
      value: status ? formatUptime(status.uptime) : "—",
      icon: Timer,
      tone: "text-fg-muted",
      ring: "border-border",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`flex items-center gap-3 rounded-lg border bg-bg-card px-3 py-2.5 ${s.ring}`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-elevated">
            <s.icon className={`h-4 w-4 ${s.tone}`} />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle truncate">
              {s.label}
            </span>
            <span className={`text-base font-semibold tabular-nums ${s.tone}`}>
              {s.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useFeedStore } from "@/lib/store";
import { formatUptime } from "@/lib/format";
import { Activity, Inbox, Layers, Timer } from "lucide-react";

export function StatsBar() {
  const status = useFeedStore((s) => s.status);
  const poolCount = useFeedStore((s) => s.pools.length);

  const stats = [
    {
      label: "Detected",
      value: status?.detectedTotal ?? 0,
      icon: Activity,
      tone: "text-accent-green",
    },
    {
      label: "In feed",
      value: poolCount,
      icon: Inbox,
      tone: "text-fg",
    },
    {
      label: "Queued",
      value: status?.queued ?? 0,
      icon: Layers,
      tone: "text-fg-muted",
    },
    {
      label: "Uptime",
      value: status ? formatUptime(status.uptime) : "—",
      icon: Timer,
      tone: "text-fg-muted",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex items-center gap-3 rounded-lg border border-border bg-bg-card px-3 py-2.5"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-elevated">
            <s.icon className={`h-4 w-4 ${s.tone}`} />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
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

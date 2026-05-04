"use client";

import { Crosshair, Ban, Loader2 } from "lucide-react";
import type { Decision } from "@sniperbot/shared";

interface DecisionBadgeProps {
  decision?: Decision;
  score?: number;
}

export function DecisionBadge({ decision, score }: DecisionBadgeProps) {
  if (!decision) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-border bg-bg-elevated px-2 py-0.5 text-[10px] font-semibold text-fg-dim">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        EVAL
      </span>
    );
  }

  if (decision === "snipe") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent-green">
        <Crosshair className="h-2.5 w-2.5" />
        SNIPE
        {typeof score === "number" && (
          <span className="font-mono tabular-nums">{score}</span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded border border-accent-red/40 bg-accent-red/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent-red">
      <Ban className="h-2.5 w-2.5" />
      REJECT
      {typeof score === "number" && (
        <span className="font-mono tabular-nums">{score}</span>
      )}
    </span>
  );
}

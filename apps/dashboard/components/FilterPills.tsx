"use client";

import { type FilterId, FILTER_LABELS, FILTER_ORDER } from "@sniperbot/shared";
import type { FilterResult } from "@sniperbot/shared";

interface FilterPillsProps {
  results: FilterResult[];
  compact?: boolean;
}

const STATUS_STYLES = {
  pass: "bg-accent-green/15 text-accent-green border-accent-green/30",
  fail: "bg-accent-red/15 text-accent-red border-accent-red/30",
  skip: "bg-bg-elevated text-fg-dim border-border-subtle",
  error: "bg-accent-amber/15 text-accent-amber border-accent-amber/30",
} as const;

const STATUS_GLYPH = {
  pass: "✓",
  fail: "✕",
  skip: "—",
  error: "!",
} as const;

export function FilterPills({ results, compact = false }: FilterPillsProps) {
  const byId = new Map(results.map((r) => [r.filterId, r]));
  const ordered = FILTER_ORDER.map((id) => ({ id, result: byId.get(id) }));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ordered.map(({ id, result }) => (
        <Pill key={id} id={id} result={result} compact={compact} />
      ))}
    </div>
  );
}

function Pill({
  id,
  result,
  compact,
}: {
  id: FilterId;
  result: FilterResult | undefined;
  compact: boolean;
}) {
  const status = result?.status ?? "skip";
  const cls = STATUS_STYLES[status];
  const label = FILTER_LABELS[id];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${cls}`}
      title={result ? `${label}: ${result.reason}` : label}
    >
      <span className="font-bold">{STATUS_GLYPH[status]}</span>
      {!compact && <span className="font-semibold tracking-wide">{label}</span>}
    </span>
  );
}

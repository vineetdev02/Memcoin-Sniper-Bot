"use client";

import { useState } from "react";
import { FILTER_LABELS, type ShadowFilterRow, type ShadowReport } from "@sniperbot/shared";
import { CheckCircle2, AlertTriangle, MinusCircle } from "lucide-react";

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const fmtPct = (v: number) => `${v < 10 ? v.toFixed(1) : v.toFixed(0)}%`;

type Verdict = "good" | "mixed" | "bad" | "thin";

/**
 * A filter earns its keep when what it lets through pumps clearly more often
 * than what it turns away. Against the overall rate instead, a filter that
 * rejects nine launches in ten could never look good: its rejects are the overall rate.
 */
function judge(row: ShadowFilterRow): Verdict {
  if (row.failed < 30 || row.passed < 30) return "thin";
  const rejected = pct(row.failedPumped, row.failed);
  const passed = pct(row.passedPumped, row.passed);
  if (passed >= rejected * 2) return "good";
  if (rejected >= passed) return "bad";
  return "mixed";
}

const VERDICT = {
  good: { icon: CheckCircle2, cls: "text-accent-green", text: "what it passes pumps far more often" },
  mixed: { icon: MinusCircle, cls: "text-accent-amber", text: "only a small edge" },
  bad: { icon: AlertTriangle, cls: "text-accent-red", text: "turns away more winners than it lets through" },
  thin: { icon: MinusCircle, cls: "text-fg-subtle", text: "too few launches either side to tell" },
} as const;

/**
 * Every launch the shadow tracker followed, bought or not: for each filter, how
 * often the launches it rejected went on to pump, against the rate for all launches.
 */
export function ShadowReportCard({ report }: { report: ShadowReport }) {
  const [hover, setHover] = useState<string | null>(null);
  const base = pct(report.pumped, report.launches);
  const rows = report.filters.filter((r) => r.failed + r.passed > 0);
  const scale = Math.max(base, ...rows.map((r) => pct(r.failedPumped, r.failed)), ...rows.map((r) => pct(r.passedPumped, r.passed)), 1);
  const picks = pct(report.snipesPumped, report.snipes);

  return (
    <div className="rounded-lg border border-border bg-bg-card">
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
        <div className="text-sm font-medium">What each filter turned away</div>
        <div className="text-xs text-fg-muted">
          Every launch the shadow tracker followed in the last 24 hours, bought or not:{" "}
          <span className="tabular-nums text-fg">{report.launches.toLocaleString()}</span> launches, of which{" "}
          <span className="tabular-nums text-fg">{fmtPct(base)}</span> rose {report.pumpThresholdPct}%+ within{" "}
          {report.horizonMin} min of the verdict.
          {report.snipes > 0 && (
            <>
              {" "}The bot&apos;s own picks: <span className="tabular-nums text-fg">{fmtPct(picks)}</span> of{" "}
              <span className="tabular-nums text-fg">{report.snipes}</span>.
            </>
          )}
        </div>
      </div>
      {report.launches === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-fg-muted">
          No launch has finished its 15-minute follow yet. With SHADOW_TRACKING on, the first ones land about 20
          minutes after the bot starts.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
              <tr>
                <th className="px-4 py-2 text-left">Filter</th>
                <th className="px-3 py-2 text-right">Rejected</th>
                <th className="w-[38%] px-3 py-2 text-left">…of which pumped (line = all launches)</th>
                <th className="px-3 py-2 text-right">Passed → pumped</th>
                <th className="px-4 py-2 text-left">Read</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rate = pct(r.failedPumped, r.failed);
                const v = VERDICT[judge(r)];
                const Icon = v.icon;
                return (
                  <tr
                    key={r.filterId}
                    className="relative border-t border-border-subtle hover:bg-bg-elevated/40"
                    onPointerEnter={() => setHover(r.filterId)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <td className="px-4 py-2 font-medium">{FILTER_LABELS[r.filterId] ?? r.filterId}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{r.failed.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="relative h-2.5 flex-1 rounded-sm bg-bg-elevated">
                          <div
                            className="absolute inset-y-0 left-0 rounded-sm bg-accent-blue/70"
                            style={{ width: `${(rate / scale) * 100}%` }}
                          />
                          <div
                            className="absolute -inset-y-1 w-0.5 bg-fg-muted"
                            style={{ left: `${(base / scale) * 100}%` }}
                            aria-hidden
                          />
                        </div>
                        <span className="w-12 text-right tabular-nums">{r.failed > 0 ? fmtPct(rate) : "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                      {r.passed.toLocaleString()} → {r.passed > 0 ? fmtPct(pct(r.passedPumped, r.passed)) : "—"}
                    </td>
                    <td className={`px-4 py-2 ${v.cls}`}>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Icon className="h-3.5 w-3.5" />
                        {v.text}
                      </span>
                      {hover === r.filterId && (
                        <div className="pointer-events-none absolute right-4 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-border bg-bg-card/95 px-2 py-1 text-xs text-fg shadow-lg tabular-nums">
                          rejected {r.failed.toLocaleString()}, {r.failedPumped} pumped · passed{" "}
                          {r.passed.toLocaleString()}, {r.passedPumped} pumped · all launches {fmtPct(base)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

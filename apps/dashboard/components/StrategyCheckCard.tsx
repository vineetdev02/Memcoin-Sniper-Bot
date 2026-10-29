"use client";

import { useState } from "react";
import type { StrategyCheck, StrategyCheckRow, StrategyVerdict } from "@sniperbot/shared";
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

/** Per-trade money to the cent, sign first: +$7.12, -$4.62. */
const money = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`;
const tone = (v: number | null) => (v === null ? "text-fg-subtle" : v > 0 ? "text-accent-green" : v < 0 ? "text-accent-red" : "text-fg-muted");

const VERDICT: Record<StrategyVerdict, { icon: typeof CheckCircle2; cls: string; text: string }> = {
  holds: { icon: CheckCircle2, cls: "text-accent-green", text: "makes money, in both halves, by more than luck explains" },
  unclear: { icon: MinusCircle, cls: "text-accent-amber", text: "cannot be told apart from break-even yet" },
  loses: { icon: AlertTriangle, cls: "text-accent-red", text: "loses money, by more than luck explains" },
  thin: { icon: MinusCircle, cls: "text-fg-subtle", text: "too few trades to tell" },
};

function Verdict({ v }: { v: StrategyVerdict }) {
  const { icon: Icon, cls, text } = VERDICT[v];
  return (
    <span className={`flex items-center gap-1.5 whitespace-nowrap ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {text}
    </span>
  );
}

const halves = (r: StrategyCheckRow) => (
  <>
    <span className={tone(r.firstHalfPerTradeUsd)}>{r.firstHalfPerTradeUsd === null ? "—" : money(r.firstHalfPerTradeUsd)}</span>
    {" / "}
    <span className={tone(r.secondHalfPerTradeUsd)}>{r.secondHalfPerTradeUsd === null ? "—" : money(r.secondHalfPerTradeUsd)}</span>
  </>
);

const range = (r: StrategyCheckRow) =>
  r.perTradeLowUsd === null || r.perTradeHighUsd === null ? null : `${money(r.perTradeLowUsd)} to ${money(r.perTradeHighUsd)}`;

/**
 * Per-trade result at each entry delay: bars either side of break-even, a
 * whisker across each one's 95% range, the current delay in bold.
 */
function DelayBars({ rows, current }: { rows: StrategyCheckRow[]; current: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const scale = Math.max(
    1,
    ...rows.map((r) => Math.max(Math.abs(r.perTradeUsd), Math.abs(r.perTradeLowUsd ?? 0), Math.abs(r.perTradeHighUsd ?? 0))),
  );
  // a position on the bar track, 50% being break-even
  const at = (v: number) => 50 + (v / scale) * 50;
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r) => {
        const w = r.trades > 0 ? (Math.abs(r.perTradeUsd) / scale) * 50 : 0;
        const up = r.perTradeUsd > 0;
        const mine = r.entrySec === current;
        return (
          <div
            key={r.entrySec}
            className="relative flex items-center gap-3 rounded px-1 py-0.5 text-xs hover:bg-bg-elevated/40"
            onPointerEnter={() => setHover(r.entrySec)}
            onPointerLeave={() => setHover(null)}
          >
            <span className={`w-10 shrink-0 text-right tabular-nums ${mine ? "font-medium text-fg" : "text-fg-muted"}`}>
              {r.entrySec}s
            </span>
            <div className="relative h-3 flex-1">
              <div className="absolute inset-y-[-2px] left-1/2 w-px bg-fg-subtle/60" aria-hidden />
              {r.trades > 0 && (
                <div
                  className={`absolute inset-y-0 ${up ? "rounded-r-[4px] bg-accent-green/70" : "rounded-l-[4px] bg-accent-red/70"}`}
                  style={up ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                />
              )}
              {r.perTradeLowUsd !== null && r.perTradeHighUsd !== null && (
                <div
                  className="absolute inset-y-[3px] border-x border-fg/50 before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-fg/50"
                  style={{ left: `${at(r.perTradeLowUsd)}%`, width: `${at(r.perTradeHighUsd) - at(r.perTradeLowUsd)}%` }}
                  aria-hidden
                />
              )}
            </div>
            <span className={`w-16 shrink-0 text-right tabular-nums ${tone(r.trades > 0 ? r.perTradeUsd : null)}`}>
              {r.trades > 0 ? money(r.perTradeUsd) : "—"}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-fg-subtle">n={r.trades}</span>
            {hover === r.entrySec && (
              <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-border bg-bg-card/95 px-2 py-1 text-xs text-fg shadow-lg tabular-nums">
                buy {r.entrySec}s in · {r.trades} trades · total {money(r.totalUsd)} · won {(r.winRate * 100).toFixed(0)}% ·
                halves {halves(r)}
                {range(r) && <> · 95% range {range(r)}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The current settings replayed on every pump.fun launch the shadow tracker
 * followed: what they would have made, against buying every launch at the
 * same moment, and at other entry delays.
 */
export function StrategyCheckCard({ check }: { check: StrategyCheck }) {
  const y = check.yours;
  return (
    <div className="rounded-lg border border-border bg-bg-card">
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
        <div className="text-sm font-medium">Strategy check</div>
        <div className="text-xs text-fg-muted">
          Your current settings, replayed on the{" "}
          <span className="tabular-nums text-fg">{check.launches.toLocaleString()}</span> pump.fun launches the shadow
          tracker followed in the last 24 hours: buy <span className="tabular-nums text-fg">{y.entrySec}s</span> after
          launch
          {y.minCurveSol > 0 && (
            <>
              {" "}when the curve holds <span className="tabular-nums text-fg">{y.minCurveSol} SOL</span> or more
            </>
          )}
          , <span className="tabular-nums text-fg">${check.stakeUsd.toFixed(0)}</span> a trade, then your stop-loss,
          take-profit ladder, trailing stop and time exit.
        </div>
      </div>

      {check.launches === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-fg-muted">
          Nothing to replay yet. With SHADOW_TRACKING on, the first launches land about 20 minutes after the bot starts.
        </div>
      ) : (
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle">Per trade</div>
              <div className={`text-3xl font-semibold tabular-nums ${tone(y.trades > 0 ? y.perTradeUsd : null)}`}>
                {y.trades > 0 ? money(y.perTradeUsd) : "—"}
              </div>
              {range(y) && (
                <div className="text-xs tabular-nums text-fg-muted">
                  95% range: <span className="text-fg">{range(y)}</span> a trade
                </div>
              )}
              <div className="mt-1 text-xs">
                <Verdict v={y.verdict} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
              <dt className="text-fg-muted">Trades</dt>
              <dd className="text-right">{y.trades}</dd>
              <dt className="text-fg-muted">Total</dt>
              <dd className={`text-right ${tone(y.trades > 0 ? y.totalUsd : null)}`}>{money(y.totalUsd)}</dd>
              <dt className="text-fg-muted">Won</dt>
              <dd className="text-right">{y.trades > 0 ? `${(y.winRate * 100).toFixed(0)}%` : "—"}</dd>
              <dt className="text-fg-muted">Earlier / later half</dt>
              <dd className="text-right">{halves(y)}</dd>
              <dt className="text-fg-muted">Best / worst</dt>
              <dd className="text-right">
                {y.trades > 0 ? (
                  <>
                    <span className={tone(y.bestUsd)}>{money(y.bestUsd)}</span> /{" "}
                    <span className={tone(y.worstUsd)}>{money(y.worstUsd)}</span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
            <div className="rounded-md border border-border-subtle px-3 py-2 text-xs text-fg-muted">
              Buying <em>every</em> launch at {check.everyLaunch.entrySec}s with the same exits:{" "}
              <span className={`tabular-nums ${tone(check.everyLaunch.trades > 0 ? check.everyLaunch.perTradeUsd : null)}`}>
                {money(check.everyLaunch.perTradeUsd)}
              </span>{" "}
              a trade over <span className="tabular-nums">{check.everyLaunch.trades}</span>
              {range(check.everyLaunch) && <> (95% range {range(check.everyLaunch)})</>}.
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
              Same rule, other entry delays · per trade, with its 95% range
            </div>
            <DelayBars rows={check.byDelay} current={y.entrySec} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border px-4 py-2 text-[11px] text-fg-subtle">
        {check.notReplayed.length > 0 && (
          <span className="text-accent-amber">
            Not replayed: {check.notReplayed.join(", ")}. These judge the early trading, which the shadow files do not
            hold, so this counts every launch past the Demand line.
          </span>
        )}
        <span>
          Paper costs: pump.fun&apos;s 1.25% each way, the average sandwich on entry, exits filled 3 s late, a graduated
          coin sold 20% under the curve&apos;s last price. SOL at ${check.solUsd.toFixed(2)}
          {check.solUsdEstimated ? " (estimated — Jupiter had no price)" : ""}. A replay is evidence, not a promise:
          a rule found on one night has to hold on the next.
        </span>
      </div>
    </div>
  );
}

import { FILTER_LABELS, type FilterId, type StrategyCheck, type StrategyCheckRow, type StrategyVerdict, type TpRung } from "@sniperbot/shared";
import { filterConfig } from "../config/filter-config.js";
import { tpLadder, tradingSettings } from "../config/trading-settings.js";
import { fetchQuotes } from "../execution/market-price.js";
import { SOL_MINT, SOL_PRICE_USD_FALLBACK } from "../feeds/parsers/common.js";
import { SHADOW_DIR, type CurveSample } from "./shadow-tracker.js";
import { readShadowLines, WINDOW_MS, type ShadowLine } from "./shadow-report.js";

/**
 * Replays the current entry and exit settings on every pump.fun launch the
 * shadow tracker followed, so a strategy is judged on a thousand launches a
 * night instead of the few dozen the bot itself buys. Every trade moves along
 * the curve's own x*y=k and pays what a paper trade pays. Set against ten of
 * the bot's own paper trades on the second night, it came out about $2 a
 * trade kinder in total, with single trades off by as much as $30 either way
 * (the live exits poll a quote, the replay reads 3 s curve samples): trust
 * its totals over any one trade.
 */

// every pump.fun curve seen so far starts with this many raw tokens in its virtual reserve
const V_TOKEN_0 = 1.073e15;
// a curve this close to graduating has nothing left to buy into
const MAX_ENTRY_SOL = 80;
// fewer trades than this and a verdict is noise
const MIN_TRADES = 20;
export const DELAYS_SEC = [10, 15, 20, 30, 60, 90];

export interface CurveCosts {
  stakeSol: number;
  // pump.fun's fee, on the buy and on the sell
  feePct: number;
  // the average sandwich cost the paper executor charges on entry
  mevPct: number;
  // an exit fills at the curve this long after the price that triggered it
  latencySec: number;
  // a graduated coin is sold on the AMM it moved to, this far below the curve's last price
  graduationHaircutPct: number;
}

export const PAPER_COSTS: Omit<CurveCosts, "stakeSol"> = {
  feePct: 1.25,
  // 30% of buys are sandwiched, for 0.5-3% (1.75% on average)
  mevPct: 0.525,
  latencySec: 3,
  graduationHaircutPct: 20,
};

export interface ExitRules {
  stopLossPct: number;
  tpLadder: TpRung[];
  trailingStopPct: number;
  trailingStopActivationPct: number;
  timeExitMin: number;
}

export interface ReplayedTrade {
  pnlSol: number;
  reason: "stop-loss" | "trailing-stop" | "tp" | "time-exit" | "graduated" | "window-end";
  peakPct: number;
}

/** The last sample at or before `t`. */
function stateAt(samples: CurveSample[], t: number): CurveSample | undefined {
  let cur: CurveSample | undefined;
  for (const s of samples) {
    if (s[0] > t) break;
    cur = s;
  }
  return cur;
}

/**
 * Virtual SOL the curve started with: 30 for a normal launch, ~736.5 for a
 * Mayhem one. From price = (V0 + s)^2 * 1e9 / (V0 * V_TOKEN_0), the larger root.
 */
export function curveV0(solIn: number, price: number): number {
  const c = (price * V_TOKEN_0) / 1e9;
  const b = c - 2 * solIn;
  const disc = b * b - 4 * solIn * solIn;
  return disc < 0 ? 30 : (b + Math.sqrt(disc)) / 2;
}

/** Raw tokens a buy of `sol` gets from a curve at this state. */
function buyTokens(solIn: number, price: number, sol: number, v0: number, c: CurveCosts): number {
  const vSol = v0 + solIn;
  const vToken = (vSol * 1e9) / price;
  const net = sol * (1 - c.feePct / 100);
  return (vToken * net) / (vSol + net) / (1 + c.mevPct / 100);
}

/** SOL that selling `tokens` back into a curve at this state returns. */
function sellTokens(solIn: number, price: number, tokens: number, v0: number, c: CurveCosts): number {
  const vSol = v0 + solIn;
  const vToken = (vSol * 1e9) / price;
  return ((vSol * tokens) / (vToken + tokens)) * (1 - c.feePct / 100);
}

/**
 * One trade bought `entrySec` after detection and run through the exits the
 * way the exit engine runs them: stop-loss, then the trailing stop, then the
 * ladder, then the time exit for a trade that never reached +50%. Null when
 * the curve was not readable at the entry or was already about to graduate.
 */
export function replayTrade(
  samples: CurveSample[],
  graduated: boolean,
  // how long the tracker followed the launch; the path is known up to here
  endSec: number,
  entrySec: number,
  exits: ExitRules,
  c: CurveCosts,
): ReplayedTrade | null {
  const first = stateAt(samples, entrySec);
  if (!first || first[2] <= 0 || first[1] >= MAX_ENTRY_SOL) return null;
  const v0 = curveV0(first[1], first[2]);
  const tokens0 = buyTokens(first[1], first[2], c.stakeSol, v0, c);
  if (!(tokens0 > 0)) return null;
  // lamports per raw token, like the samples' price
  const entryPrice = (c.stakeSol * 1e9) / tokens0;
  let remaining = tokens0;
  let proceeds = 0;
  let peak = first[2];
  let armed = false;
  const hit = exits.tpLadder.map(() => false);
  const timeExitAt = entrySec + exits.timeExitMin * 60;
  const checks = [...new Set([...samples.map((s) => s[0]), timeExitAt])]
    .filter((t) => t > entrySec && t <= endSec)
    .sort((a, b) => a - b);
  const sellAt = (t: number, tokens: number) => {
    const fill = stateAt(samples, t + c.latencySec)!;
    return sellTokens(fill[1], fill[2], tokens, v0, c);
  };
  const last = samples[samples.length - 1]!;

  for (const t of checks) {
    const price = stateAt(samples, t)![2];
    peak = Math.max(peak, price);
    const gain = (price / entryPrice - 1) * 100;
    const peakGain = (peak / entryPrice - 1) * 100;
    const close = (reason: ReplayedTrade["reason"]): ReplayedTrade => {
      proceeds += sellAt(t, remaining);
      return { pnlSol: proceeds - c.stakeSol, reason, peakPct: peakGain };
    };
    if (gain <= exits.stopLossPct) return close("stop-loss");
    if (peakGain >= exits.trailingStopActivationPct) armed = true;
    if (armed && ((peak - price) / peak) * 100 >= exits.trailingStopPct) return close("trailing-stop");
    // a jump past several rungs sells each of them at this fill
    for (let i = exits.tpLadder.length - 1; i >= 0; i--) {
      if (hit[i] || gain < exits.tpLadder[i]!.gainPct) continue;
      for (let j = 0; j <= i; j++) {
        if (hit[j]) continue;
        hit[j] = true;
        const q = Math.min(remaining, (tokens0 * exits.tpLadder[j]!.sellPct) / 100);
        proceeds += sellAt(t, q);
        remaining -= q;
      }
      break;
    }
    if (remaining <= tokens0 * 0.001) return { pnlSol: proceeds - c.stakeSol, reason: "tp", peakPct: peakGain };
    if (t >= timeExitAt && peakGain < 50) return close("time-exit");
  }

  const peakPct = (peak / entryPrice - 1) * 100;
  if (graduated) {
    // the curve emptied into an AMM; what is still held sells there, below the curve's last price
    proceeds += ((remaining * last[2]) / 1e9) * (1 - c.feePct / 100) * (1 - c.graduationHaircutPct / 100);
    return { pnlSol: proceeds - c.stakeSol, reason: "graduated", peakPct };
  }
  proceeds += sellTokens(last[1], last[2], remaining, v0, c);
  return { pnlSol: proceeds - c.stakeSol, reason: "window-end", peakPct };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Where the per-trade mean probably lies: 1.96 standard errors either side.
 * A few graduations carry every winning rule, so with twenty trades this is
 * wide, and it should be: one more graduation moves the mean by dollars.
 */
export function perTradeRange(xs: number[]): [number, number] | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  const half = (1.96 * sd) / Math.sqrt(xs.length);
  return [m - half, m + half];
}

export function verdictFor(
  trades: number,
  range: [number, number] | null,
  first: number | null,
  second: number | null,
): StrategyVerdict {
  if (trades < MIN_TRADES || !range) return "thin";
  if (range[1] < 0) return "loses";
  return range[0] > 0 && first !== null && second !== null && first > 0 && second > 0 ? "holds" : "unclear";
}

interface Launch {
  detectedAt: number;
  samples: CurveSample[];
  graduated: boolean;
  endSec: number;
}

/** A launch the tracker followed to the end of its window or to graduation; restarts cut the rest short. */
export function replayable(lines: ShadowLine[], fromTs: number): Launch[] {
  const out: Launch[] = [];
  for (const l of lines) {
    if (l.detectedAt === undefined || l.detectedAt < fromTs) continue;
    if ((l.end !== "window" && l.end !== "complete") || l.samples.length === 0) continue;
    const endSec = l.followedSec ?? l.samples[l.samples.length - 1]![0];
    out.push({ detectedAt: l.detectedAt, samples: l.samples, graduated: l.end === "complete", endSec });
  }
  return out.sort((a, b) => a.detectedAt - b.detectedAt);
}

export function replayRule(
  launches: Launch[],
  entrySec: number,
  minCurveSol: number,
  exits: ExitRules,
  c: CurveCosts,
  solUsd: number,
): StrategyCheckRow {
  const half = launches.length > 0 ? launches[Math.floor(launches.length / 2)]!.detectedAt : 0;
  const all: number[] = [];
  const early: number[] = [];
  const late: number[] = [];
  for (const l of launches) {
    const at = stateAt(l.samples, entrySec);
    // a curve with nothing in it at the entry is never bought: there is no price to buy at
    if (!at || at[1] <= 0 || at[1] < minCurveSol) continue;
    const t = replayTrade(l.samples, l.graduated, l.endSec, entrySec, exits, c);
    if (!t) continue;
    const usd = t.pnlSol * solUsd;
    all.push(usd);
    (l.detectedAt < half ? early : late).push(usd);
  }
  const total = all.reduce((s, x) => s + x, 0);
  const perTrade = all.length ? total / all.length : 0;
  const first = mean(early);
  const second = mean(late);
  const range = perTradeRange(all);
  return {
    entrySec,
    minCurveSol,
    trades: all.length,
    totalUsd: total,
    perTradeUsd: perTrade,
    perTradeLowUsd: range?.[0] ?? null,
    perTradeHighUsd: range?.[1] ?? null,
    winRate: all.length ? all.filter((x) => x > 0).length / all.length : 0,
    bestUsd: all.length ? Math.max(...all) : 0,
    worstUsd: all.length ? Math.min(...all) : 0,
    firstHalfPerTradeUsd: first,
    secondHalfPerTradeUsd: second,
    verdict: verdictFor(all.length, range, first, second),
  };
}

export interface CheckInput {
  lines: ShadowLine[];
  fromTs: number;
  toTs: number;
  entrySec: number;
  // the Demand line when that filter is on, else 0
  minCurveSol: number;
  exits: ExitRules;
  stakeUsd: number;
  solUsd: number;
  solUsdEstimated: boolean;
  notReplayed: string[];
}

export function buildStrategyCheck(input: CheckInput): StrategyCheck {
  const launches = replayable(input.lines, input.fromTs);
  const c: CurveCosts = { ...PAPER_COSTS, stakeSol: input.stakeUsd / input.solUsd };
  const run = (entrySec: number, minSol: number) => replayRule(launches, entrySec, minSol, input.exits, c, input.solUsd);
  return {
    launches: launches.length,
    fromTs: input.fromTs,
    toTs: input.toTs,
    stakeUsd: input.stakeUsd,
    solUsd: input.solUsd,
    solUsdEstimated: input.solUsdEstimated,
    yours: run(input.entrySec, input.minCurveSol),
    everyLaunch: run(input.entrySec, 0),
    // the current delay is one of the rows, so the chart marks it exactly
    byDelay: [...new Set([...DELAYS_SEC, input.entrySec])].sort((a, b) => a - b).map((d) => run(d, input.minCurveSol)),
    notReplayed: input.notReplayed,
  };
}

/**
 * Filters a replay cannot run, because they judge the early trading or the
 * creator rather than the curve. The rest always pass on a pump.fun curve,
 * and the Demand filter is the replay's own minimum.
 */
const NOT_REPLAYABLE: FilterId[] = [
  "dev-wallet",
  "top-holders",
  "liquidity-min",
  "bundled-launch",
  "insider-detection",
  "social-signal",
  "volume-velocity",
  "anti-sniper-war",
  "smart-money",
];
const CACHE_MS = 60_000;
const SOL_PRICE_MS = 10 * 60_000;

let solPrice: { at: number; usd: number } | null = null;
let cached: { at: number; key: string; check: StrategyCheck } | null = null;

async function solUsdNow(now: number): Promise<{ usd: number; estimated: boolean }> {
  if (solPrice && now - solPrice.at < SOL_PRICE_MS) return { usd: solPrice.usd, estimated: false };
  const q = (await fetchQuotes([SOL_MINT])).get(SOL_MINT);
  if (!q) return { usd: solPrice?.usd ?? SOL_PRICE_USD_FALLBACK, estimated: !solPrice };
  solPrice = { at: now, usd: q.priceUsd };
  return { usd: q.priceUsd, estimated: false };
}

/** The current settings on the last 24 hours of shadow-tracked launches, rebuilt at most once a minute. */
export async function loadStrategyCheck(balanceUsd: number, now = Date.now()): Promise<StrategyCheck> {
  const s = tradingSettings();
  const cfg = filterConfig.resolve();
  const exits: ExitRules = {
    stopLossPct: s.stopLossPct,
    tpLadder: tpLadder(),
    trailingStopPct: s.trailingStopPct,
    trailingStopActivationPct: s.trailingStopActivationPct,
    timeExitMin: s.timeExitMin,
  };
  const stakeUsd = (balanceUsd * s.positionSizePct) / 100;
  const minCurveSol = cfg.enabled("curve-demand") ? cfg.minCurveSol : 0;
  // the filters and the entry quote take about two seconds once the wait is over (17 s for a 15 s wait, live)
  const entrySec = s.evalDelaySec + 2;
  const key = JSON.stringify([exits, Math.round(stakeUsd), minCurveSol, entrySec]);
  if (cached && cached.key === key && now - cached.at < CACHE_MS) return cached.check;
  const sol = await solUsdNow(now);
  const fromTs = now - WINDOW_MS;
  const check = buildStrategyCheck({
    lines: await readShadowLines(SHADOW_DIR, fromTs, now),
    fromTs,
    toTs: now,
    entrySec,
    minCurveSol,
    exits,
    stakeUsd,
    solUsd: sol.usd,
    solUsdEstimated: sol.estimated,
    notReplayed: NOT_REPLAYABLE.filter((id) => cfg.enabled(id)).map((id) => FILTER_LABELS[id]),
  });
  cached = { at: now, key, check };
  return check;
}

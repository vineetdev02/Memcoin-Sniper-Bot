import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CurveSample } from "./shadow-tracker.js";
import type { ShadowLine } from "./shadow-report.js";
import {
  PAPER_COSTS,
  buildStrategyCheck,
  curveV0,
  perTradeRange,
  replayRule,
  replayTrade,
  replayable,
  verdictFor,
  type CurveCosts,
  type ExitRules,
} from "./strategy-check.js";

// price in lamports per raw token of a curve holding `s` real SOL
const priceAt = (s: number, v0 = 30) => ((v0 + s) ** 2 * 1e9) / (v0 * 1.073e15);
const path = (points: [number, number][], v0 = 30): CurveSample[] => points.map(([t, s]) => [t, s, priceAt(s, v0)]);

const EXITS: ExitRules = {
  stopLossPct: -30,
  tpLadder: [
    { gainPct: 40, sellPct: 30 },
    { gainPct: 80, sellPct: 30 },
    { gainPct: 200, sellPct: 20 },
    { gainPct: 500, sellPct: 10 },
  ],
  trailingStopPct: 25,
  trailingStopActivationPct: 60,
  timeExitMin: 15,
};
const COSTS: CurveCosts = { ...PAPER_COSTS, stakeSol: 0.5 };

describe("strategy check", () => {
  test("the curve's starting reserve is read back from any state", () => {
    assert.ok(Math.abs(curveV0(0, priceAt(0)) - 30) < 1e-6);
    assert.ok(Math.abs(curveV0(12.5, priceAt(12.5)) - 30) < 1e-6);
    assert.ok(Math.abs(curveV0(3, priceAt(3, 736.5)) - 736.5) < 1e-3);
  });

  test("a curve that never moves loses the round trip and leaves on the time exit", () => {
    const t = replayTrade(path([[0, 20]]), false, 1320, 16, EXITS, COSTS)!;
    assert.equal(t.reason, "time-exit");
    // two fees, the sandwich, and the price impact in and out of a 50-SOL curve
    const lossPct = (-t.pnlSol / COSTS.stakeSol) * 100;
    assert.ok(lossPct > 3 && lossPct < 6, `lost ${lossPct.toFixed(2)}%`);
  });

  test("a fall past the stop-loss sells everything at the curve a few seconds later", () => {
    // 20 SOL -> 8 SOL takes the price from (50/30)^2 to (38/30)^2 of the start: about -42%
    const t = replayTrade(path([[0, 20], [30, 8], [33, 5]]), false, 1320, 16, EXITS, COSTS)!;
    assert.equal(t.reason, "stop-loss");
    // it fills at the 33 s state, below the one that tripped it
    assert.ok(t.pnlSol / COSTS.stakeSol < -0.5);
  });

  test("a run to graduation sells the ladder on the way and the rest below the last curve price", () => {
    const samples = path([[0, 20], [60, 45], [120, 70], [180, 84]]);
    const t = replayTrade(samples, true, 200, 16, EXITS, COSTS)!;
    assert.equal(t.reason, "graduated");
    // (114/50)^2 - 1 = +420% at the top: three rungs sold, 20% still held when the curve emptied
    assert.ok(t.peakPct > 400 && t.peakPct < 440);
    assert.ok(t.pnlSol / COSTS.stakeSol > 1.5, `made ${(t.pnlSol / COSTS.stakeSol).toFixed(2)}x`);
  });

  test("the time exit is not judged past the end of what was followed", () => {
    // followed for 5 minutes only: the trade is marked at the end, not time-exited at 15 min
    const t = replayTrade(path([[0, 20]]), false, 300, 16, EXITS, COSTS)!;
    assert.equal(t.reason, "window-end");
  });

  test("an empty or nearly graduated curve is not bought", () => {
    assert.equal(replayTrade(path([[30, 5]]), false, 1320, 16, EXITS, COSTS), null);
    assert.equal(replayTrade(path([[0, 81]]), false, 1320, 16, EXITS, COSTS), null);
  });

  test("a rule only buys curves holding its minimum at the entry, and splits the launches in halves", () => {
    const flat = (detectedAt: number, s: number) => ({ detectedAt, samples: path([[0, s]]), graduated: false, endSec: 1320 });
    const launches = [flat(1, 2), flat(2, 25), flat(3, 0.5), flat(4, 30)];
    const row = replayRule(launches, 16, 20, EXITS, COSTS, 100);
    assert.equal(row.trades, 2);
    assert.equal(row.verdict, "thin");
    assert.ok(row.perTradeUsd < 0 && row.firstHalfPerTradeUsd! < 0 && row.secondHalfPerTradeUsd! < 0);
    assert.equal(replayRule(launches, 16, 0, EXITS, COSTS, 100).trades, 4);
  });

  test("a verdict needs 20 trades, a range clear of break-even, and both halves to hold", () => {
    assert.equal(verdictFor(19, [1, 9], 5, 5), "thin");
    assert.equal(verdictFor(40, [-6, -0.5], 3, -3), "loses");
    // negative on average, but the range takes in break-even: not a loss anyone has shown
    assert.equal(verdictFor(40, [-6, 2], -1, -3), "unclear");
    assert.equal(verdictFor(40, [0.5, 6], 6, -1), "unclear");
    assert.equal(verdictFor(40, [-4, 9], 1, 3), "unclear");
    assert.equal(verdictFor(40, [0.5, 6], 1, 3), "holds");
  });

  test("the per-trade range narrows with more trades and is centred on the mean", () => {
    assert.equal(perTradeRange([5]), null);
    const few = perTradeRange([-20, 30, -20, 30])!;
    const many = perTradeRange(Array.from({ length: 256 }, (_, i) => (i % 2 ? 30 : -20)))!;
    assert.ok(Math.abs((few[0] + few[1]) / 2 - 5) < 1e-9 && Math.abs((many[0] + many[1]) / 2 - 5) < 1e-9);
    assert.ok(few[0] < 0 && many[0] > 0, `few ${few.join("..")}, many ${many.join("..")}`);
  });

  test("lines cut short by a restart, or from before the window, are not replayed", () => {
    const line = (end: string, detectedAt?: number): ShadowLine => ({
      detectedAt,
      verdictAt: null,
      decision: null,
      end,
      samples: path([[0, 3]]),
    });
    const kept = replayable([line("window", 50), line("cut", 60), line("complete", 70), line("window", 5), line("window")], 10);
    assert.deepEqual(kept.map((l) => [l.detectedAt, l.graduated]), [[50, false], [70, true]]);
  });

  test("the check reports the current rule, every launch, and the other delays", () => {
    const lines: ShadowLine[] = [0, 25, 3].map((s, i) => ({
      detectedAt: 100 + i,
      verdictAt: null,
      decision: null,
      end: "window",
      followedSec: 1320,
      samples: path([[0, s]]),
    }));
    const check = buildStrategyCheck({
      lines,
      fromTs: 0,
      toTs: 1000,
      entrySec: 16,
      minCurveSol: 20,
      exits: EXITS,
      stakeUsd: 50,
      solUsd: 100,
      solUsdEstimated: false,
      notReplayed: ["Volume"],
    });
    assert.equal(check.launches, 3);
    assert.equal(check.yours.trades, 1);
    assert.equal(check.everyLaunch.trades, 2);
    assert.deepEqual(check.byDelay.map((r) => r.entrySec), [10, 15, 16, 20, 30, 60, 90]);
    assert.deepEqual(check.byDelay[2], check.yours);
    assert.deepEqual(check.notReplayed, ["Volume"]);
  });
});

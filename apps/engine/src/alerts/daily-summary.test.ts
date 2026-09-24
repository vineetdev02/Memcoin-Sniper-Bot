import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, nextUtcHour, summarize, type ClosedTrade } from "./daily-summary.js";

const TO = Date.UTC(2026, 8, 24, 0, 0);
const FROM = TO - DAY_MS;

function trade(pnl: number, over: Partial<ClosedTrade> = {}): ClosedTrade {
  return { mint: "M", realizedPnlUsd: pnl, entrySizeUsd: 100, closeReason: "tp1", closedAt: FROM + 1000, ...over };
}

describe("summarize", () => {
  test("counts, money and extremes", () => {
    const s = summarize(
      [trade(80, { mint: "BEST" }), trade(-40, { mint: "WORST", closeReason: "stop-loss" }), trade(20), trade(-10, { closeReason: "rug-pull" })],
      FROM,
      TO,
    );
    assert.equal(s.closed, 4);
    assert.equal(s.wins, 2);
    assert.equal(s.losses, 2);
    assert.equal(s.winRatePct, 50);
    assert.equal(s.realizedPnlUsd, 50);
    assert.equal(s.deployedUsd, 400);
    assert.equal(s.roiPct, 12.5);
    assert.equal(s.profitFactor, 2);
    assert.equal(s.best?.mint, "BEST");
    assert.equal(s.worst?.mint, "WORST");
    assert.equal(s.rugs, 1);
  });

  test("break-even is not a win, matching the position store", () => {
    const s = summarize([trade(0)], FROM, TO);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 1);
  });

  test("the window is [from, to): a trade exactly at the boundary belongs to the next report", () => {
    const s = summarize([trade(5, { closedAt: FROM }), trade(5, { closedAt: TO }), trade(5, { closedAt: FROM - 1 })], FROM, TO);
    assert.equal(s.closed, 1);
  });

  test("no losses is an infinite profit factor; no trades is zero, not NaN", () => {
    assert.equal(summarize([trade(10)], FROM, TO).profitFactor, Infinity);
    const empty = summarize([], FROM, TO);
    assert.equal(empty.profitFactor, 0);
    assert.equal(empty.roiPct, 0);
    assert.equal(empty.winRatePct, 0);
    assert.equal(empty.best, null);
  });
});

describe("nextUtcHour", () => {
  test("later today, tomorrow, and never the current instant", () => {
    assert.equal(nextUtcHour(Date.UTC(2026, 8, 24, 3, 0), 5), Date.UTC(2026, 8, 24, 5, 0));
    assert.equal(nextUtcHour(Date.UTC(2026, 8, 24, 23, 30), 0), Date.UTC(2026, 8, 25, 0, 0));
    assert.equal(nextUtcHour(Date.UTC(2026, 8, 24, 0, 0), 0), Date.UTC(2026, 8, 25, 0, 0));
  });

  test("rolls over month and year ends", () => {
    assert.equal(nextUtcHour(Date.UTC(2026, 11, 31, 22, 0), 0), Date.UTC(2027, 0, 1, 0, 0));
  });
});

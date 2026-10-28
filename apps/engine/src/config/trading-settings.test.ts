import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseTpLadder, validateSettingsPatch, type TradingSettings } from "@sniperbot/shared";
import { mergeOverrides } from "./trading-settings.js";

const base: TradingSettings = {
  positionSizePct: 1,
  maxConcurrentPositions: 10,
  maxTotalExposurePct: 30,
  maxPositionPerMin: 3,
  stopLossPct: -40,
  tpLadder: "50:25,100:25",
  trailingStopPct: 30,
  trailingStopActivationPct: 200,
  timeExitMin: 30,
  dailyDrawdownLimitPct: 10,
  weeklyDrawdownLimitPct: 25,
  haltOnConsecutiveLosses: 20,
  evalDelaySec: 90,
};

describe("validateSettingsPatch", () => {
  test("values in range pass", () => {
    assert.deepEqual(validateSettingsPatch({ positionSizePct: 2.5, stopLossPct: -30, evalDelaySec: 0 }), {
      ok: true,
      value: { positionSizePct: 2.5, stopLossPct: -30, evalDelaySec: 0 },
    });
  });

  test("an unknown key is refused, so a typo cannot read as saved", () => {
    assert.equal(validateSettingsPatch({ positionSizePc: 2 }).ok, false);
  });

  test("out of range, the wrong sign, a fraction where a count goes, and text are refused", () => {
    assert.equal(validateSettingsPatch({ positionSizePct: 0 }).ok, false);
    assert.equal(validateSettingsPatch({ positionSizePct: 101 }).ok, false);
    assert.equal(validateSettingsPatch({ stopLossPct: 40 }).ok, false);
    assert.equal(validateSettingsPatch({ maxConcurrentPositions: 2.5 }).ok, false);
    assert.equal(validateSettingsPatch({ timeExitMin: "30" }).ok, false);
    assert.equal(validateSettingsPatch({ timeExitMin: Number.NaN }).ok, false);
    assert.equal(validateSettingsPatch(null).ok, false);
    assert.equal(validateSettingsPatch([1]).ok, false);
  });

  test("the take-profit ladder is checked for shape and for selling at most everything", () => {
    assert.deepEqual(validateSettingsPatch({ tpLadder: " 50:25, 100:75 " }), { ok: true, value: { tpLadder: "50:25,100:75" } });
    assert.equal(validateSettingsPatch({ tpLadder: "50:60,100:60" }).ok, false);
    assert.equal(validateSettingsPatch({ tpLadder: "50-25" }).ok, false);
    assert.equal(validateSettingsPatch({ tpLadder: "0:25" }).ok, false);
  });
});

describe("parseTpLadder", () => {
  test("reads the .env format", () => {
    assert.deepEqual(parseTpLadder("50:25,100:25"), [
      { gainPct: 50, sellPct: 25 },
      { gainPct: 100, sellPct: 25 },
    ]);
  });
});

describe("mergeOverrides", () => {
  test("keeps only what differs from .env, so untouched settings still follow it", () => {
    assert.deepEqual(mergeOverrides(base, {}, { positionSizePct: 2, timeExitMin: 30 }), { positionSizePct: 2 });
  });

  test("setting a value back to its .env default removes the override", () => {
    assert.deepEqual(mergeOverrides(base, { positionSizePct: 2, stopLossPct: -20 }, { positionSizePct: 1 }), {
      stopLossPct: -20,
    });
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rebuildPosition, type OpenPositionRow, type TradeRow } from "./position-restore.js";

const settings = { trailingStopPct: 30, trailingStopActivationPct: 200, timeExitMin: 30 };

const trade = (over: Partial<TradeRow>): TradeRow => ({
  id: "t",
  side: "buy",
  status: "filled",
  priceUsd: 1,
  amountTokens: 100,
  amountUsd: 100,
  feeSol: 0,
  slippagePct: 0,
  mevPenaltyPct: null,
  exitReason: null,
  signature: null,
  executedAt: new Date(1_000),
  ...over,
});

const row = (trades: TradeRow[]): OpenPositionRow => ({
  id: "p1",
  tokenMint: "MINT",
  mode: "paper",
  entryPriceUsd: 1,
  entrySizeUsd: 100,
  tokensHeld: 100,
  currentPriceUsd: 1,
  peakPriceUsd: 1,
  peakGainPct: 0,
  filterScore: 90,
  tpLadder: [
    { gainPct: 50, sellPct: 25, hit: false },
    { gainPct: 100, sellPct: 25, hit: false },
  ],
  stopLossPct: -40,
  openedAt: new Date(1_000),
  pool: { poolAddress: "MINT", source: "raydium_amm", signature: "sig", initialLiquidityUsd: 0 },
  trades,
});

describe("rebuildPosition", () => {
  test("an untouched position comes back exactly as it was opened", () => {
    const { position } = rebuildPosition(row([trade({})]), settings);
    assert.equal(position.status, "open");
    assert.equal(position.remainingTokens, 100);
    assert.equal(position.realizedPnlUsd, 0);
    assert.equal(position.source, "raydium-amm");
    assert.ok(position.tpLadder.every((l) => !l.hit));
  });

  test("a take-profit sold before the restart is read back from its trade", () => {
    const { position, trades } = rebuildPosition(
      row([
        trade({ id: "buy" }),
        // TP1: 25 tokens at 1.5 → 37.5 back for 25 of cost
        trade({ id: "tp1", side: "sell", priceUsd: 1.5, amountTokens: 25, amountUsd: 37.5, exitReason: "tp1", executedAt: new Date(2_000) }),
      ]),
      settings,
    );
    assert.equal(position.status, "partial");
    assert.equal(position.remainingTokens, 75);
    assert.equal(position.realizedPnlUsd, 12.5);
    assert.deepEqual(position.tpLadder.map((l) => l.hit), [true, false]);
    assert.equal(position.currentPriceUsd, 1.5, "the last sale is the latest price seen");
    assert.equal(position.peakGainPct, 50);
    assert.equal(trades[1]?.exitReason, "tp1");
  });

  test("Prisma's snake_case exit reasons come back in the app's spelling", () => {
    const { trades } = rebuildPosition(
      row([trade({}), trade({ side: "sell", amountTokens: 1, amountUsd: 0.5, exitReason: "stop_loss" })]),
      settings,
    );
    assert.equal(trades[1]?.exitReason, "stop-loss");
  });
});

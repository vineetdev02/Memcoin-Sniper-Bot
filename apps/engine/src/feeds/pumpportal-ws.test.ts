import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readPumpPortalMessage } from "./pumpportal-ws.js";
import { SOL_MINT } from "./parsers/common.js";

const MINT = "5uKDTokenMint111111111111111111111111111111";
const DEV = "DevWa11et11111111111111111111111111111111111";
const SIG = "4xZ1Sig".padEnd(88, "1");
const NOW = 1_700_000_000_000;
const ALL = { pumpfun: true, pumpswap: true };

// The shape PumpPortal sends, captured from the live feed.
const create = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    signature: SIG,
    mint: MINT,
    traderPublicKey: DEV,
    txType: "create",
    initialBuy: 0,
    solAmount: 0,
    bondingCurveKey: "Curve1111111111111111111111111111111111111",
    vTokensInBondingCurve: 1073000000,
    vSolInBondingCurve: 30,
    marketCapSol: 27.96,
    name: "Example",
    symbol: "EX",
    uri: "https://example.invalid/meta.json",
    pool: "pump",
    ...over,
  });
const migrate = (pool: string) => JSON.stringify({ signature: SIG, mint: MINT, txType: "migrate", pool });

describe("readPumpPortalMessage", () => {
  test("a pump.fun launch becomes a pool event with no RPC call", () => {
    const item = readPumpPortalMessage(create(), NOW, ALL);
    assert.equal(item?.kind, "pool");
    if (item?.kind !== "pool") return;
    assert.equal(item.event.source, "pumpfun");
    assert.equal(item.event.tokenMint, MINT);
    assert.equal(item.event.poolAddress, MINT);
    assert.equal(item.event.baseMint, SOL_MINT);
    assert.equal(item.event.creatorWallet, DEV);
    assert.equal(item.event.signature, SIG);
    assert.equal(item.event.detectedAt, NOW);
  });

  test("a PumpSwap migration is handed on to be parsed from its transaction", () => {
    assert.deepEqual(readPumpPortalMessage(migrate("pump-amm"), NOW, ALL), {
      kind: "migration",
      creation: { signature: SIG, source: "pumpswap", receivedAt: NOW },
    });
  });

  test("LetsBonk launches and Raydium migrations are dropped: nothing downstream knows them", () => {
    assert.equal(readPumpPortalMessage(create({ pool: "bonk" }), NOW, ALL), null);
    assert.equal(readPumpPortalMessage(migrate("raydium-cpmm"), NOW, ALL), null);
  });

  test("a disabled source is dropped", () => {
    assert.equal(readPumpPortalMessage(create(), NOW, { pumpfun: false, pumpswap: true }), null);
    assert.equal(readPumpPortalMessage(migrate("pump-amm"), NOW, { pumpfun: true, pumpswap: false }), null);
  });

  test("acknowledgements and errors are notices", () => {
    assert.deepEqual(
      readPumpPortalMessage(JSON.stringify({ message: "Successfully subscribed to token creation events." }), NOW, ALL),
      { kind: "notice", text: "Successfully subscribed to token creation events." },
    );
    assert.deepEqual(readPumpPortalMessage(JSON.stringify({ errors: "rate limited" }), NOW, ALL), {
      kind: "notice",
      text: "rate limited",
    });
  });

  test("anything that is not a usable key is refused, not passed on to throw in a filter", () => {
    assert.equal(readPumpPortalMessage("not json", NOW, ALL), null);
    assert.equal(readPumpPortalMessage("null", NOW, ALL), null);
    assert.equal(readPumpPortalMessage(create({ mint: "0OIl-not-base58" }), NOW, ALL), null);
    assert.equal(readPumpPortalMessage(create({ mint: undefined }), NOW, ALL), null);
    assert.equal(readPumpPortalMessage(create({ traderPublicKey: 42 }), NOW, ALL), null);
    assert.equal(readPumpPortalMessage(create({ signature: "short" }), NOW, ALL), null);
  });
});

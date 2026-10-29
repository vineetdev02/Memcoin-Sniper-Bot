import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { filterOnByDefault } from "@sniperbot/shared";
import type { ShadowLine } from "./shadow-report.js";
import { earlyBuysOf, parseSeed, pickSmartWallets, type EarlyBuys } from "./smart-wallets.js";
import { buyersFrom } from "../filters/smart-money.js";

const launch = (graduated: boolean, ...buyers: string[]): EarlyBuys => ({ mint: `m${Math.random()}`, detectedAt: 1, graduated, buyers });

describe("smart wallets", () => {
  test("a wallet counts with two graduates among its early buys at one in ten or better", () => {
    const launches = [
      launch(true, "picker", "everywhere"),
      launch(true, "picker", "everywhere", "lucky"),
      ...Array.from({ length: 8 }, () => launch(false, "picker")),
      // buys everything: two graduates in thirty is under one in ten
      ...Array.from({ length: 28 }, () => launch(false, "everywhere")),
      launch(false, "lucky"),
    ];
    assert.deepEqual([...pickSmartWallets(launches)], ["picker"]);
  });

  test("one wallet listed twice in a launch counts once", () => {
    assert.equal(pickSmartWallets([launch(true, "a", "a"), launch(true, "a"), launch(false, "a")]).size, 1);
    assert.equal(pickSmartWallets([launch(true, "a", "a"), launch(false, "a")]).size, 0);
  });

  test("the filter's recorded buyers come back from a finished shadow line only", () => {
    const line = (end: string): ShadowLine => ({
      mint: "M",
      detectedAt: 5,
      verdictAt: 20,
      decision: "reject",
      end,
      samples: [],
      filters: { "smart-money": ["fail", { buyers: ["x", "y"], smart: [] }] },
    });
    assert.deepEqual(earlyBuysOf(line("complete")), { mint: "M", detectedAt: 5, graduated: true, buyers: ["x", "y"] });
    assert.equal(earlyBuysOf(line("cut")), null);
    assert.equal(earlyBuysOf({ ...line("window"), filters: {} }), null);
  });

  test("the seed keeps buys only, without the creator", () => {
    const text = [
      JSON.stringify({ mint: "A", detectedAt: 9, graduated: false, creator: "dev", trades: [[0, "dev", -1], [0, "b1", -0.5], [1, "seller", 0.3], [2, "dust", -0.001]] }),
      '{"mint":"half',
    ].join("\n");
    assert.deepEqual(parseSeed(text), [{ mint: "A", detectedAt: 9, graduated: false, buyers: ["b1"] }]);
  });

  test("a transaction's signer is a buyer when it spent SOL, once, and never the creator", () => {
    const tx = (signer: string, pre: number, post: number) => ({
      transaction: { message: { accountKeys: [signer, "curve"] } },
      meta: { preBalances: [pre, 0], postBalances: [post, 0], err: null },
    });
    const failed = { ...tx("f", 2e9, 1e9), meta: { preBalances: [2e9], postBalances: [1e9], err: { x: 1 } } };
    const txs = [tx("dev", 5e9, 4e9), tx("a", 3e9, 2.5e9), null, tx("seller", 1e9, 1.4e9), tx("a", 2.5e9, 2e9), failed, tx("b", 1e9, 0.9e9)];
    assert.deepEqual(buyersFrom(txs, "dev"), ["a", "b"]);
  });

  test("Smart Money is off unless a preset turns it on; the rest stay on", () => {
    assert.equal(filterOnByDefault("smart-money"), false);
    assert.equal(filterOnByDefault("honeypot-sim"), true);
  });
});

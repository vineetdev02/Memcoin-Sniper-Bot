import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pickPair, type DexScreenerPair } from "./dexscreener-client.js";

const pair = (pairAddress: string, usd?: number) =>
  ({ pairAddress, liquidity: usd === undefined ? undefined : { usd } }) as DexScreenerPair;

describe("pickPair", () => {
  test("takes the most liquid pair; a curve pair with no liquidity figure ranks last", () => {
    assert.equal(pickPair([pair("curve"), pair("small", 500), pair("big", 90_000)])?.pairAddress, "big");
  });

  test("a lone pump.fun curve pair is still returned", () => {
    assert.equal(pickPair([pair("curve")])?.pairAddress, "curve");
  });

  test("no pairs is null", () => {
    assert.equal(pickPair([]), null);
  });
});

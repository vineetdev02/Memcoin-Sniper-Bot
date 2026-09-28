import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { detectPairFromBalances, SOL_MINT } from "./common.js";

const TOKEN = "5uKDTokenMint111111111111111111111111111111";
const LP = "5GzKLpMint11111111111111111111111111111111";

const bal = (mint: string) => ({ accountIndex: 0, mint, uiTokenAmount: { amount: "1", decimals: 6, uiAmount: 1, uiAmountString: "1" } });
const tx = (pre: string[], post: string[]) =>
  ({ meta: { preTokenBalances: pre.map(bal), postTokenBalances: post.map(bal) } }) as unknown as ParsedTransactionWithMeta;

describe("detectPairFromBalances", () => {
  test("a pool creation picks the deposited token, not the LP mint it creates", () => {
    // the shape of a real PumpSwap CreatePool: token in pre, WSOL and LP new
    assert.deepEqual(detectPairFromBalances(tx([TOKEN], [TOKEN, SOL_MINT, LP])), { baseMint: TOKEN, quoteMint: SOL_MINT });
    // the order balances come back in must not matter
    assert.deepEqual(detectPairFromBalances(tx([TOKEN], [LP, SOL_MINT, TOKEN])), { baseMint: TOKEN, quoteMint: SOL_MINT });
  });

  test("a single unknown mint is the token even when it is new", () => {
    assert.deepEqual(detectPairFromBalances(tx([], [SOL_MINT, TOKEN])), { baseMint: TOKEN, quoteMint: SOL_MINT });
  });

  test("two new mints and nothing to tell them apart is refused, not guessed", () => {
    assert.equal(detectPairFromBalances(tx([], [TOKEN, SOL_MINT, LP])), null);
  });
});

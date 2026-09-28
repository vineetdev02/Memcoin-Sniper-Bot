import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import type { PoolEvent } from "@sniperbot/shared";
import { topHoldersFilter } from "./top-holders.js";
import type { FilterContext } from "./types.js";

const SUPPLY = 1_000_000_000;
// a program-derived address: what a bonding curve or pool vault is owned by
const CURVE = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve")], Keypair.generate().publicKey)[0];

/** Holders as [owner or null when unreadable, amount], largest first. */
function ctxWith(holders: [PublicKey | null, number][]): FilterContext {
  const accounts = holders.map(([, amount]) => ({
    address: Keypair.generate().publicKey,
    amount: String(amount),
    decimals: 6,
    uiAmount: amount / 1e6,
    uiAmountString: String(amount / 1e6),
  }));
  const conn = {
    getTokenLargestAccounts: async () => ({ context: { slot: 1 }, value: accounts }),
    getTokenSupply: async () => ({ context: { slot: 1 }, value: { amount: String(SUPPLY), decimals: 6 } }),
    getMultipleParsedAccounts: async () => ({
      context: { slot: 1 },
      value: holders.map(([owner]) =>
        owner
          ? { data: { program: "spl-token", parsed: { info: { owner: owner.toBase58() } }, space: 165 } }
          : null,
      ),
    }),
  } as unknown as Connection;
  return {
    conn,
    isSynthetic: false,
    cfg: { topHolderMaxPct: 12, top10HoldersMaxPct: 30 } as FilterContext["cfg"],
  };
}

const pool = { tokenMint: Keypair.generate().publicKey.toBase58() } as PoolEvent;
const wallet = () => Keypair.generate().publicKey;

describe("top-holders", () => {
  test("a fresh pump.fun token is not 'concentrated' just because its curve holds the supply", async () => {
    const r = await topHoldersFilter.evaluate(
      pool,
      ctxWith([
        [CURVE, 0.93 * SUPPLY],
        [wallet(), 0.05 * SUPPLY], // the dev's buy
        [wallet(), 0.01 * SUPPLY],
      ]),
    );
    assert.equal(r.status, "pass");
    assert.equal(Math.round(r.metadata?.top1 as number), 5);
    assert.equal(Math.round(r.metadata?.programHeldPct as number), 93);
    assert.match(r.reason, /pool\/curve accounts holding 93\.0% excluded/);
  });

  test("a wallet holding 40% still fails", async () => {
    const r = await topHoldersFilter.evaluate(
      pool,
      ctxWith([
        [CURVE, 0.5 * SUPPLY],
        [wallet(), 0.4 * SUPPLY],
      ]),
    );
    assert.equal(r.status, "fail");
    assert.equal(Math.round(r.metadata?.top1 as number), 40);
  });

  test("an owner that cannot be read counts as a wallet, never as a pool", async () => {
    const r = await topHoldersFilter.evaluate(pool, ctxWith([[null, 0.9 * SUPPLY]]));
    assert.equal(r.status, "fail");
    assert.equal(r.metadata?.programHeldPct, 0);
  });
});

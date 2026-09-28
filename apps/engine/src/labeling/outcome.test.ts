import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { SOL_MINT, USDC_MINT } from "../feeds/parsers/common.js";
import {
  classifyFlow,
  creatorQuoteGain,
  decideLabel,
  findCollapse,
  findWithdrawal,
  measureSurvival,
  resolveVaults,
  sampleAt,
  summarizeTx,
  tallyTraders,
  type ReservePoint,
  type TokenRow,
  type TxSummary,
  type Vaults,
} from "./outcome.js";

const MINT = "TokenMint1111111111111111111111111111111111";
const CREATOR = "Creator111111111111111111111111111111111111";
const QV = "QuoteVault11111111111111111111111111111111";
const BV = "BaseVault111111111111111111111111111111111";
const AMM: Vaults = { quote: { account: QV, kind: "token" }, base: BV };
const H = 3600;

function row(account: string, mint: string, owner: string, pre: number, post: number, opened = false): TokenRow {
  return { account, mint, owner, pre, post, opened };
}

function tx(over: Partial<TxSummary> & { tokens?: TokenRow[] }): TxSummary {
  return {
    signature: over.signature ?? `sig${Math.random()}`,
    blockTime: over.blockTime ?? 0,
    ok: true,
    feePayer: over.feePayer ?? "Trader",
    feeLamports: over.feeLamports ?? 5000,
    keys: over.keys ?? [],
    preLamports: over.preLamports ?? [],
    postLamports: over.postLamports ?? [],
    tokens: over.tokens ?? [],
  };
}

/** A swap against the AMM vaults: positive dq is quote into the pool. */
function swap(feePayer: string, dq: number, db: number, blockTime = 0): TxSummary {
  return tx({
    feePayer,
    blockTime,
    tokens: [row(QV, SOL_MINT, "Authority", 100, 100 + dq), row(BV, MINT, "Authority", 1000, 1000 + db)],
  });
}

function points(...pairs: [number, number][]): ReservePoint[] {
  return pairs.map(([t, reserve]) => ({ t, reserve, signature: `s${t}` }));
}

describe("summarizeTx", () => {
  test("merges pre and post balances by account and marks accounts the tx opened", () => {
    const keys = [CREATOR, QV, BV].map(() => PublicKey.unique());
    const parsed = {
      blockTime: 1_700_000_000,
      transaction: {
        message: {
          accountKeys: keys.map((pubkey, i) => ({ pubkey, signer: i === 0, writable: true })),
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [10, 0, 0],
        postBalances: [9, 2, 2],
        preTokenBalances: [
          { accountIndex: 1, mint: SOL_MINT, owner: "A", uiTokenAmount: { amount: "1000000000", decimals: 9, uiAmount: 1 } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: SOL_MINT, owner: "A", uiTokenAmount: { amount: "3000000000", decimals: 9, uiAmount: 3 } },
          { accountIndex: 2, mint: MINT, owner: "A", uiTokenAmount: { amount: "5000000", decimals: 6, uiAmount: 5 } },
        ],
      },
    } as unknown as ParsedTransactionWithMeta;

    const s = summarizeTx("sig", parsed);
    assert.ok(s);
    assert.equal(s.feePayer, keys[0]!.toBase58());
    assert.deepEqual(
      s.tokens.map((t) => [t.account, t.pre, t.post, t.opened]),
      [
        [keys[1]!.toBase58(), 1, 3, false],
        [keys[2]!.toBase58(), 0, 5, true],
      ],
    );
  });

  test("a transaction with no block time cannot be placed on the timeline", () => {
    assert.equal(summarizeTx("sig", { blockTime: null, meta: {} } as unknown as ParsedTransactionWithMeta), null);
  });
});

describe("resolveVaults", () => {
  const q = { tokenMint: MINT, quoteMint: SOL_MINT, creator: CREATOR };

  test("the vault is the non-creator account that received the deposit, not the creator's own", () => {
    const creation = tx({
      tokens: [
        row("CreatorWsol", SOL_MINT, CREATOR, 50, 0),
        row("FeeWsol", SOL_MINT, "Raydium", 0, 0.4, true),
        row(QV, SOL_MINT, "Authority", 0, 40, true),
        row("CreatorAta", MINT, CREATOR, 1000, 0),
        row(BV, MINT, "Authority", 0, 1000, true),
      ],
    });
    assert.deepEqual(resolveVaults(creation, q), AMM);
  });

  test("two equal deposits are ambiguous and return a reason instead of a guess", () => {
    const creation = tx({
      tokens: [row("A", SOL_MINT, "X", 0, 5, true), row("B", SOL_MINT, "Y", 0, 5, true), row(BV, MINT, "Z", 0, 1, true)],
    });
    assert.match(resolveVaults(creation, q) as string, /quote vault: two accounts/);
  });

  test("a launchpad's empty quote vault is found when it is the only one opened", () => {
    const creation = tx({
      tokens: [row(QV, SOL_MINT, "Pool", 0, 0, true), row(BV, MINT, "Pool", 0, 1000, true)],
    });
    assert.deepEqual(resolveVaults(creation, q), AMM);
  });

  test("pump.fun reads SOL off the bonding curve itself and tokens off the curve's account", () => {
    const creation = tx({
      keys: [CREATOR, "Curve"],
      tokens: [row("CurveAta", MINT, "Curve", 0, 900, true), row("DevAta", MINT, CREATOR, 0, 100, true)],
    });
    assert.deepEqual(resolveVaults(creation, { ...q, bondingCurve: "Curve" }), {
      quote: { account: "Curve", kind: "lamports" },
      base: "CurveAta",
    });
  });
});

describe("classifyFlow", () => {
  test("reads direction from the pool's side", () => {
    assert.equal(classifyFlow(swap("T", 1, -10), AMM), "buy");
    assert.equal(classifyFlow(swap("T", -1, 10), AMM), "sell");
    assert.equal(classifyFlow(swap("T", 1, 10), AMM), "add");
    assert.equal(classifyFlow(swap("T", -1, -10), AMM), "remove");
    assert.equal(classifyFlow(tx({}), AMM), "none");
  });

  test("works on a bonding curve's lamports", () => {
    const curve: Vaults = { quote: { account: "Curve", kind: "lamports" }, base: "CurveAta" };
    const sell = tx({
      keys: ["Seller", "Curve"],
      preLamports: [0, 5e9],
      postLamports: [1e9, 4e9],
      tokens: [row("CurveAta", MINT, "Curve", 100, 150)],
    });
    assert.equal(classifyFlow(sell, curve), "sell");
  });
});

describe("creatorQuoteGain", () => {
  test("adds the fee back, so paying for the tx does not hide a withdrawal", () => {
    const t = tx({ feePayer: CREATOR, feeLamports: 1e9, keys: [CREATOR], preLamports: [10e9], postLamports: [14e9] });
    assert.equal(creatorQuoteGain(t, CREATOR, SOL_MINT), 5);
  });

  test("counts wrapped SOL the creator holds, and ignores lamports on a USDC pair", () => {
    const t = tx({
      keys: [CREATOR],
      preLamports: [10e9],
      postLamports: [20e9],
      tokens: [row("W", SOL_MINT, CREATOR, 0, 3), row("U", USDC_MINT, CREATOR, 0, 700)],
    });
    assert.equal(creatorQuoteGain(t, CREATOR, SOL_MINT), 13);
    assert.equal(creatorQuoteGain(t, CREATOR, USDC_MINT), 700);
  });
});

describe("findCollapse", () => {
  test("a fall below 10% of the running peak inside 24h is a collapse", () => {
    const c = findCollapse(points([0, 5], [H, 40], [2 * H, 30], [3 * H, 2]), 0);
    assert.deepEqual(c, { peak: 40, peakAt: H, low: 2, lowAt: 3 * H });
  });

  test("an 85% fall is not one, and neither is a fall after the window", () => {
    assert.equal(findCollapse(points([0, 40], [H, 6]), 0), null);
    assert.equal(findCollapse(points([0, 40], [25 * H, 1]), 0), null);
  });
});

describe("measureSurvival", () => {
  test("reads the reserve at the 7-day mark against the peak up to it", () => {
    const s = measureSurvival(points([0, 10], [H, 40], [6 * 24 * H, 25], [8 * 24 * H, 1]), 0);
    assert.deepEqual(s, { peak: 40, atHorizon: 25, retainedPct: 62.5 });
  });
});

describe("sampleAt", () => {
  test("takes the last transaction at or before each point, once", () => {
    const sigs = [0, 100, 250, 400].map((t) => ({ signature: `s${t}`, t }));
    assert.deepEqual(
      sampleAt(sigs, 0, [120, 200, 300, 1000]).map((s) => s.t),
      [100, 250, 400],
    );
  });
});

describe("findWithdrawal", () => {
  test("the creator gaining SOL while the reserve falls is a withdrawal", () => {
    const pull = swap(CREATOR, -30, -900);
    pull.keys = [CREATOR];
    pull.preLamports = [1e9];
    pull.postLamports = [31e9];
    pull.feePayer = CREATOR;
    pull.feeLamports = 0;
    assert.equal(findWithdrawal([pull], AMM, CREATOR, SOL_MINT, 0.4)?.amount, 30);
  });

  test("the creator selling back a dust amount, or buying, is not", () => {
    const dust = swap(CREATOR, -0.1, 5);
    dust.keys = [CREATOR];
    dust.preLamports = [1e9];
    dust.postLamports = [1.1e9];
    const buy = swap(CREATOR, 5, -50);
    assert.equal(findWithdrawal([dust, buy], AMM, CREATOR, SOL_MINT, 0.4), null);
  });
});

describe("tallyTraders", () => {
  test("a creator sell never clears a honeypot", () => {
    const t = tallyTraders([swap("A", 1, -1), swap("B", 1, -1), swap(CREATOR, -1, 1)], AMM, CREATOR);
    assert.deepEqual([...t.buyers], ["A", "B"]);
    assert.equal(t.sellers.size, 0);
  });
});

describe("decideLabel", () => {
  test("most specific wins", () => {
    assert.equal(decideLabel({ honeypot: "yes", rug: "yes", good: "no" }), "honeypot");
    assert.equal(decideLabel({ honeypot: "no", rug: "yes", good: "no" }), "rug");
    assert.equal(decideLabel({ honeypot: "no", rug: "no", good: "yes" }), "good");
  });

  test("anything unknown keeps a pool out of the good set", () => {
    assert.equal(decideLabel({ honeypot: "no", rug: "unknown", good: "yes" }), null);
    assert.equal(decideLabel({ honeypot: "unknown", rug: "no", good: "yes" }), null);
    assert.equal(decideLabel({ honeypot: "no", rug: "no", good: "unknown" }), null);
  });
});

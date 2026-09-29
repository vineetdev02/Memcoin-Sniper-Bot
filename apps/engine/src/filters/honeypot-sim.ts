import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { env } from "../config/env.js";
import { SOL_MINT } from "../feeds/parsers/common.js";

/**
 * 0.01 SOL: large enough that integer rounding means nothing, small enough to
 * barely move a pool. This used to sell 1 token — for a memecoin a few
 * lamports' worth — and the rounding alone read as a 10–100% "price impact".
 */
const PROBE_LAMPORTS = 10_000_000;
/**
 * Jupiter indexes a new pool minutes after launch. Until then "no route"
 * means "not indexed", NOT "honeypot": skip rather than emit a false positive.
 */
const FRESH_POOL_GRACE_MS = 5 * 60_000;
const TIMEOUT_MS = 4000;

type Quote = { ok: true; outAmount: string } | { ok: false; noRoute: boolean; reason: string };

async function quote(inputMint: string, outputMint: string, amount: string): Promise<Quote> {
  const url = new URL(`${env.JUPITER_QUOTE_API}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", "300");

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const noRoute = res.status === 400 || res.status === 404;
      return { ok: false, noRoute, reason: noRoute ? `no route (${res.status})` : `Jupiter API ${res.status}` };
    }
    const body = (await res.json()) as { outAmount?: string; routePlan?: unknown[] };
    if (!body.outAmount || !body.routePlan || body.routePlan.length === 0) {
      return { ok: false, noRoute: true, reason: "no route" };
    }
    return { ok: true, outAmount: body.outAmount };
  } catch (err) {
    const e = err as Error;
    return { ok: false, noRoute: false, reason: e.name === "AbortError" ? "Jupiter timeout" : `Jupiter error: ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export const honeypotSimFilter: Filter = {
  id: "honeypot-sim",
  weight: 15, // critical filter — heaviest weight
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    const cfg = ctx.cfg;
    const done = (
      status: "pass" | "fail" | "skip" | "error",
      reason: string,
      metadata?: Record<string, unknown>,
    ) => makeResult("honeypot-sim", status, reason, { metadata, durationMs: Date.now() - start });

    if (!cfg.honeypotSimRequired) return done("skip", "filter disabled");

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const safe = ctx.syntheticMock.honeypotSafe;
      const tax = ctx.syntheticMock.sellTaxPct;
      const taxFail = tax > cfg.maxSellTaxPct;
      return done(
        !safe || taxFail ? "fail" : "pass",
        !safe
          ? "Jupiter cannot route a sell — HONEYPOT"
          : taxFail
            ? `sell tax ${tax}% > max ${cfg.maxSellTaxPct}%`
            : `sell route OK (tax ${tax}%)`,
        { sellTaxPct: tax },
      );
    }

    // On a bonding curve every sell is executed by the pump.fun program, which
    // cannot refuse it and takes only its fixed fee. There is no honeypot or
    // sell tax to find — and Jupiter, which indexes new curves minutes late,
    // was calling most of them honeypots.
    if (pool.source === "pumpfun") {
      return done("pass", "bonding curve — the pump.fun program executes every sell; no honeypot or tax possible", {
        status: "bonding-curve",
      });
    }

    // Anywhere else: buy 0.01 SOL of the token, sell exactly that back, and see
    // what the round trip costs. Transfer taxes and blocked sells show up here.
    const fresh = Date.now() - pool.detectedAt < FRESH_POOL_GRACE_MS;
    const ageSec = Math.round((Date.now() - pool.detectedAt) / 1000);

    const buy = await quote(SOL_MINT, pool.tokenMint, String(PROBE_LAMPORTS));
    if (!buy.ok) {
      if (!buy.noRoute) return done("error", buy.reason);
      return fresh
        ? done("skip", `Jupiter has not indexed it yet (${ageSec}s old)`)
        : done("fail", "no route to buy it at all — not tradable");
    }

    const sell = await quote(pool.tokenMint, SOL_MINT, buy.outAmount);
    if (!sell.ok) {
      if (!sell.noRoute) return done("error", sell.reason);
      return fresh
        ? done("skip", `sell route not indexed yet (${ageSec}s old)`)
        : done("fail", "can buy but not sell — HONEYPOT");
    }

    const roundTripLossPct = (1 - Number(sell.outAmount) / PROBE_LAMPORTS) * 100;
    const metadata = { roundTripLossPct, probeLamports: PROBE_LAMPORTS, tokensBought: buy.outAmount, lamportsBack: sell.outAmount };
    return roundTripLossPct > cfg.maxSellTaxPct
      ? done("fail", `0.01 SOL round trip loses ${roundTripLossPct.toFixed(1)}% > max ${cfg.maxSellTaxPct}% — sell tax or thin pool`, metadata)
      : done("pass", `0.01 SOL round trip costs ${roundTripLossPct.toFixed(1)}%`, metadata);
  },
};

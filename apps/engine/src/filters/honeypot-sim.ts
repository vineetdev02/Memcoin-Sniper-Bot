import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { env } from "../config/env.js";
import { SOL_MINT } from "../feeds/parsers/common.js";

const SIM_AMOUNT = 1_000_000; // 1 token (assuming 6 decimals — best effort)

export const honeypotSimFilter: Filter = {
  id: "honeypot-sim",
  weight: 15, // critical filter — heaviest weight
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();
    if (!env.FILTER_HONEYPOT_SIM_REQUIRED) {
      return makeResult("honeypot-sim", "skip", "filter disabled", {
        durationMs: Date.now() - start,
      });
    }

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const safe = ctx.syntheticMock.honeypotSafe;
      const tax = ctx.syntheticMock.sellTaxPct;
      const taxFail = tax > env.FILTER_MAX_SELL_TAX_PCT;
      const failed = !safe || taxFail;
      return makeResult(
        "honeypot-sim",
        failed ? "fail" : "pass",
        !safe
          ? "Jupiter cannot route a sell — HONEYPOT"
          : taxFail
            ? `sell tax ${tax}% > max ${env.FILTER_MAX_SELL_TAX_PCT}%`
            : `sell route OK (tax ${tax}%)`,
        { metadata: { sellTaxPct: tax }, durationMs: Date.now() - start },
      );
    }

    try {
      const url = new URL(`${env.JUPITER_QUOTE_API}/quote`);
      url.searchParams.set("inputMint", pool.tokenMint);
      url.searchParams.set("outputMint", SOL_MINT);
      url.searchParams.set("amount", SIM_AMOUNT.toString());
      url.searchParams.set("slippageBps", "300");
      url.searchParams.set("onlyDirectRoutes", "false");

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      let res: Response;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        if (res.status === 400 || res.status === 404) {
          return makeResult(
            "honeypot-sim",
            "fail",
            `Jupiter cannot route sell (${res.status}) — likely HONEYPOT`,
            { metadata: { httpStatus: res.status }, durationMs: Date.now() - start },
          );
        }
        return makeResult(
          "honeypot-sim",
          "error",
          `Jupiter API ${res.status}`,
          { durationMs: Date.now() - start },
        );
      }

      const body = (await res.json()) as {
        outAmount?: string;
        priceImpactPct?: string;
        routePlan?: unknown[];
      };

      if (!body.outAmount || !body.routePlan || body.routePlan.length === 0) {
        return makeResult("honeypot-sim", "fail", "no sell route — HONEYPOT", {
          durationMs: Date.now() - start,
        });
      }

      const priceImpact = Number(body.priceImpactPct ?? 0) * 100;
      // Use price impact as a proxy for sell tax — real tax detection needs
      // simulating the tx with a real signer. Phase 4 upgrade.
      const taxFail = priceImpact > env.FILTER_MAX_SELL_TAX_PCT;
      return makeResult(
        "honeypot-sim",
        taxFail ? "fail" : "pass",
        taxFail
          ? `price impact ${priceImpact.toFixed(2)}% > max ${env.FILTER_MAX_SELL_TAX_PCT}%`
          : `route OK · impact ${priceImpact.toFixed(2)}%`,
        {
          metadata: { priceImpactPct: priceImpact, outAmount: body.outAmount },
          durationMs: Date.now() - start,
        },
      );
    } catch (err) {
      const e = err as Error;
      const isAbort = e.name === "AbortError";
      return makeResult(
        "honeypot-sim",
        "error",
        isAbort ? "Jupiter timeout" : `Jupiter error: ${e.message}`,
        { durationMs: Date.now() - start },
      );
    }
  },
};

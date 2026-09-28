import { randomUUID } from "node:crypto";
import type { PoolEvent, OrchestratorVerdict, Trade, ExitReason } from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("paper-exec");

const SOL_USD_ESTIMATE = 200; // rough; only used to convert SOL fees to USD
const NETWORK_FEE_LAMPORTS = 5000;
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface PaperBuyResult {
  status: "filled" | "failed";
  tradeId: string;
  fillTime: number;
  effectivePriceUsd: number;
  tokensReceived: number;
  slippagePct: number;
  mevPenaltyPct: number;
  feeSol: number;
  feeUsd: number;
  costUsd: number;
  failReason?: string;
}

export interface PaperSellResult {
  tradeId: string;
  fillTime: number;
  effectivePriceUsd: number;
  tokensSold: number;
  proceedsUsd: number;
  slippagePct: number;
  feeSol: number;
  feeUsd: number;
  exitReason: ExitReason;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Slippage model: amm-ish. The bigger the trade vs liquidity, the worse.
 * sizeUsd / liquidityUsd of 1% maps to ~1% slippage; 5% → ~5%, capped at 25%.
 */
function estimateSlippagePct(sizeUsd: number, liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 25;
  const ratio = sizeUsd / liquidityUsd;
  return Math.min(25, Math.max(0.1, ratio * 100));
}

/** The market at the moment of a paper buy; absent for synthetic pools. */
export interface EntryMarket {
  priceUsd: number;
  liquidityUsd: number | null;
}

export interface PaperExecutor {
  buy(verdict: OrchestratorVerdict, pool: PoolEvent, sizeUsd: number, market?: EntryMarket): PaperBuyResult;
  sell(
    entryPriceUsd: number,
    currentPriceUsd: number,
    tokens: number,
    liquidityUsd: number,
    exitReason: ExitReason,
  ): PaperSellResult;
}

export const paperExecutor: PaperExecutor = {
  buy(verdict, pool, sizeUsd, market) {
    const fillDelay = Math.floor(rand(800, 1500));
    // With a market price the buy happens now, at that price. Without one it is
    // a synthetic pool, bought as if right after launch at its generated price.
    const fillTime = (market ? Date.now() : pool.detectedAt) + fillDelay;

    const jitoTipSol = env.JITO_TIP_LAMPORTS / LAMPORTS_PER_SOL;
    const networkSol = NETWORK_FEE_LAMPORTS / LAMPORTS_PER_SOL;
    const feeSol = jitoTipSol + networkSol;
    const feeUsd = feeSol * SOL_USD_ESTIMATE;

    // 10% of attempts fail (beat by another bot, slippage too tight, etc.)
    if (Math.random() < 0.10) {
      const tradeId = randomUUID();
      const reason = Math.random() < 0.5 ? "slippage exceeded" : "beat by another bot";
      log.warn(
        { mint: pool.tokenMint.slice(0, 8), reason, feeSol },
        "paper buy failed (fee burned)",
      );
      return {
        status: "failed",
        tradeId,
        fillTime,
        effectivePriceUsd: 0,
        tokensReceived: 0,
        slippagePct: 0,
        mevPenaltyPct: 0,
        feeSol,
        feeUsd,
        costUsd: feeUsd,
        failReason: reason,
      };
    }

    const liquidityUsd = market ? (market.liquidityUsd ?? 0) : pool.initialLiquidityUsd;
    const baseSlip = estimateSlippagePct(sizeUsd, liquidityUsd) / 100;
    const sandwichHit = Math.random() < 0.30;
    const mevPenaltyPct = sandwichHit ? rand(0.005, 0.03) : 0;

    const basePriceUsd = market ? market.priceUsd : pool.initialPriceUsd;
    const effectivePriceUsd = basePriceUsd * (1 + baseSlip + mevPenaltyPct);
    const tokensReceived = sizeUsd / effectivePriceUsd;

    return {
      status: "filled",
      tradeId: randomUUID(),
      fillTime,
      effectivePriceUsd,
      tokensReceived,
      slippagePct: baseSlip * 100,
      mevPenaltyPct: mevPenaltyPct * 100,
      feeSol,
      feeUsd,
      costUsd: sizeUsd + feeUsd,
    };
  },

  sell(entryPriceUsd, currentPriceUsd, tokens, liquidityUsd, exitReason) {
    const sizeUsd = tokens * currentPriceUsd;
    const baseSlip = estimateSlippagePct(sizeUsd, Math.max(1000, liquidityUsd)) / 100;
    // Rugs cost more to exit (thin liquidity in panic)
    const rugPenalty = exitReason === "rug-pull" ? rand(0.05, 0.20) : 0;
    const totalSlip = baseSlip + rugPenalty;

    const effectivePriceUsd = currentPriceUsd * (1 - totalSlip);
    const proceedsUsd = tokens * effectivePriceUsd;
    const networkSol = NETWORK_FEE_LAMPORTS / LAMPORTS_PER_SOL;
    const jitoTipSol = exitReason === "rug-pull"
      ? (env.JITO_TIP_LAMPORTS * 5) / LAMPORTS_PER_SOL // tip war on rug
      : env.JITO_TIP_LAMPORTS / LAMPORTS_PER_SOL;
    const feeSol = networkSol + jitoTipSol;
    const feeUsd = feeSol * SOL_USD_ESTIMATE;

    return {
      tradeId: randomUUID(),
      fillTime: Date.now(),
      effectivePriceUsd,
      tokensSold: tokens,
      proceedsUsd: proceedsUsd - feeUsd,
      slippagePct: totalSlip * 100,
      feeSol,
      feeUsd,
      exitReason,
    };
  },
};

export function buyResultToTrade(positionId: string, r: PaperBuyResult): Trade {
  return {
    id: r.tradeId,
    positionId,
    side: "buy",
    status: r.status,
    priceUsd: r.effectivePriceUsd,
    amountTokens: r.tokensReceived,
    amountUsd: r.status === "filled" ? r.costUsd - r.feeUsd : 0,
    feeSol: r.feeSol,
    slippagePct: r.slippagePct,
    mevPenaltyPct: r.mevPenaltyPct || undefined,
    executedAt: r.fillTime,
  };
}

export function sellResultToTrade(positionId: string, r: PaperSellResult): Trade {
  return {
    id: r.tradeId,
    positionId,
    side: "sell",
    status: "filled",
    priceUsd: r.effectivePriceUsd,
    amountTokens: r.tokensSold,
    amountUsd: r.proceedsUsd,
    feeSol: r.feeSol,
    slippagePct: r.slippagePct,
    exitReason: r.exitReason,
    executedAt: r.fillTime,
  };
}

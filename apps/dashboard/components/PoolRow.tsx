"use client";

import { memo } from "react";
import type { PoolEvent } from "@sniperbot/shared";
import { ExternalLink } from "lucide-react";
import { formatPriceUsd, formatRelativeTime, formatUsd, shortAddress } from "@/lib/format";

const SOURCE_STYLES: Record<string, { label: string; cls: string }> = {
  pumpfun: { label: "pump.fun", cls: "border-source-pumpfun/30 bg-source-pumpfun/10 text-source-pumpfun" },
  pumpswap: { label: "PumpSwap", cls: "border-source-pumpswap/30 bg-source-pumpswap/10 text-source-pumpswap" },
  "raydium-amm": { label: "Raydium AMM", cls: "border-source-raydium/30 bg-source-raydium/10 text-source-raydium" },
  "raydium-clmm": { label: "Raydium CLMM", cls: "border-source-raydium/30 bg-source-raydium/10 text-source-raydium" },
  "raydium-launchpad": { label: "LetsBonk", cls: "border-source-raydium/30 bg-source-raydium/10 text-source-raydium" },
  meteora: { label: "Meteora", cls: "border-source-meteora/30 bg-source-meteora/10 text-source-meteora" },
  orca: { label: "Orca", cls: "border-source-orca/30 bg-source-orca/10 text-source-orca" },
};

interface PoolRowProps {
  pool: PoolEvent;
  isNew?: boolean;
}

function PoolRowImpl({ pool, isNew }: PoolRowProps) {
  const src = SOURCE_STYLES[pool.source] ?? { label: pool.source, cls: "border-border bg-bg-elevated text-fg-muted" };
  const dexscreenerUrl = `https://dexscreener.com/solana/${pool.tokenMint}`;
  const solscanUrl = `https://solscan.io/tx/${pool.signature}`;

  return (
    <div
      className={`group relative grid grid-cols-12 gap-3 rounded-lg border border-border bg-bg-card p-3 transition-colors hover:border-border-strong hover:bg-bg-hover ${
        isNew ? "animate-slide-in" : ""
      }`}
    >
      {/* Source badge + age - mobile: top row, desktop: left column */}
      <div className="col-span-12 sm:col-span-3 lg:col-span-2 flex items-center justify-between sm:flex-col sm:items-start sm:justify-center sm:gap-1">
        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${src.cls}`}
        >
          {src.label}
        </span>
        <span className="text-[11px] text-fg-subtle tabular-nums">
          {formatRelativeTime(pool.detectedAt)}
        </span>
      </div>

      {/* Mint + creator */}
      <div className="col-span-12 sm:col-span-5 lg:col-span-5 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-fg-muted">MINT</span>
          <code className="truncate font-mono text-xs text-fg">{pool.tokenMint}</code>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-fg-subtle">DEV</span>
          <code className="truncate font-mono text-[11px] text-fg-muted">
            {shortAddress(pool.creatorWallet, 6)}
          </code>
        </div>
      </div>

      {/* Liquidity */}
      <div className="col-span-6 sm:col-span-2 lg:col-span-2 flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">Liquidity</span>
        <span className="font-mono text-sm tabular-nums text-fg">
          {formatUsd(pool.initialLiquidityUsd, { compact: true })}
        </span>
      </div>

      {/* Initial Price */}
      <div className="col-span-6 sm:col-span-2 lg:col-span-2 flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">Price</span>
        <span className="font-mono text-sm tabular-nums text-fg">
          {formatPriceUsd(pool.initialPriceUsd)}
        </span>
      </div>

      {/* Action links */}
      <div className="col-span-12 lg:col-span-1 flex items-center justify-start lg:justify-end gap-2 mt-1 lg:mt-0">
        <a
          href={dexscreenerUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-7 items-center gap-1 rounded border border-border bg-bg-elevated px-2 text-[10px] font-medium text-fg-muted hover:border-border-strong hover:text-fg"
          title="View on DexScreener"
        >
          DEX
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
        <a
          href={solscanUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-7 items-center gap-1 rounded border border-border bg-bg-elevated px-2 text-[10px] font-medium text-fg-muted hover:border-border-strong hover:text-fg"
          title="View tx on Solscan"
        >
          TX
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}

export const PoolRow = memo(PoolRowImpl);

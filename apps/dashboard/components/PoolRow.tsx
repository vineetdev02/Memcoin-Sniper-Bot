"use client";

import { memo } from "react";
import type { OrchestratorVerdict, PoolEvent } from "@sniperbot/shared";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { formatPriceUsd, formatRelativeTime, formatUsd, shortAddress } from "@/lib/format";
import { FilterPills } from "./FilterPills";
import { DecisionBadge } from "./DecisionBadge";
import { useFeedStore } from "@/lib/store";

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
  verdict?: OrchestratorVerdict;
  isNew?: boolean;
}

function PoolRowImpl({ pool, verdict, isNew }: PoolRowProps) {
  const expandedSig = useFeedStore((s) => s.expandedSig);
  const toggleExpanded = useFeedStore((s) => s.toggleExpanded);
  const expanded = expandedSig === pool.signature;

  const src = SOURCE_STYLES[pool.source] ?? {
    label: pool.source,
    cls: "border-border bg-bg-elevated text-fg-muted",
  };
  const dexscreenerUrl = `https://dexscreener.com/solana/${pool.tokenMint}`;
  const solscanUrl = `https://solscan.io/tx/${pool.signature}`;

  const decisionRing =
    verdict?.decision === "snipe"
      ? "border-l-2 border-l-accent-green"
      : verdict?.decision === "reject"
        ? "border-l-2 border-l-accent-red/50"
        : "border-l-2 border-l-border";

  return (
    <div
      className={`group rounded-lg border border-border bg-bg-card transition-colors hover:border-border-strong ${decisionRing} ${
        isNew ? "animate-slide-in" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => toggleExpanded(pool.signature)}
        className="w-full text-left"
      >
        <div className="grid grid-cols-12 gap-2 sm:gap-3 p-3">
          {/* Source + age */}
          <div className="col-span-12 sm:col-span-3 lg:col-span-2 flex items-center justify-between sm:flex-col sm:items-start sm:gap-1">
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${src.cls}`}
            >
              {src.label}
            </span>
            <span className="text-[11px] text-fg-subtle tabular-nums">
              {formatRelativeTime(pool.detectedAt)}
            </span>
          </div>

          {/* Mint + decision */}
          <div className="col-span-12 sm:col-span-5 lg:col-span-5 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <DecisionBadge decision={verdict?.decision} score={verdict?.totalScore} />
              <code className="truncate font-mono text-xs text-fg">{pool.tokenMint}</code>
            </div>
            <div className="flex items-center gap-2 min-w-0 text-fg-muted">
              <span className="text-[10px] uppercase tracking-wider text-fg-subtle">DEV</span>
              <code className="truncate font-mono text-[11px]">
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

          {/* Price */}
          <div className="col-span-6 sm:col-span-2 lg:col-span-2 flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle">Price</span>
            <span className="font-mono text-sm tabular-nums text-fg">
              {formatPriceUsd(pool.initialPriceUsd)}
            </span>
          </div>

          {/* Toggle chevron */}
          <div className="col-span-12 lg:col-span-1 flex items-center justify-end gap-2 mt-1 lg:mt-0">
            <ChevronIcon expanded={expanded} />
          </div>

          {/* Filter pills row */}
          {verdict && (
            <div className="col-span-12">
              <FilterPills results={verdict.results} compact />
            </div>
          )}
        </div>
      </button>

      {expanded && verdict && (
        <ExpandedDetail
          verdict={verdict}
          dexscreenerUrl={dexscreenerUrl}
          solscanUrl={solscanUrl}
        />
      )}
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="h-4 w-4 text-fg-subtle group-hover:text-fg" />
  ) : (
    <ChevronRight className="h-4 w-4 text-fg-subtle group-hover:text-fg" />
  );
}

function ExpandedDetail({
  verdict,
  dexscreenerUrl,
  solscanUrl,
}: {
  verdict: OrchestratorVerdict;
  dexscreenerUrl: string;
  solscanUrl: string;
}) {
  return (
    <div className="border-t border-border bg-bg-elevated p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3 text-fg-muted">
          <span>
            Score{" "}
            <span className="font-mono text-fg">
              {verdict.totalScore}/{verdict.maxScore}
            </span>
          </span>
          <span>
            Pass <span className="font-mono text-accent-green">{verdict.passedCount}</span>
          </span>
          <span>
            Fail <span className="font-mono text-accent-red">{verdict.failedCount}</span>
          </span>
          <span className="font-mono text-fg-subtle">
            {verdict.totalDurationMs}ms
          </span>
        </div>
        <div className="flex gap-2">
          <a
            href={dexscreenerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-7 items-center gap-1 rounded border border-border bg-bg-card px-2 text-[10px] font-medium text-fg-muted hover:text-fg"
          >
            DexScreener
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <a
            href={solscanUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-7 items-center gap-1 rounded border border-border bg-bg-card px-2 text-[10px] font-medium text-fg-muted hover:text-fg"
          >
            Solscan
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th className="font-medium pb-2 pr-4">Filter</th>
              <th className="font-medium pb-2 pr-4">Status</th>
              <th className="font-medium pb-2 pr-4">Reason</th>
              <th className="font-medium pb-2 text-right">ms</th>
            </tr>
          </thead>
          <tbody className="text-fg">
            {verdict.results.map((r) => (
              <tr key={r.filterId} className="border-t border-border-subtle">
                <td className="py-1.5 pr-4 font-mono text-[11px] text-fg-muted">{r.filterId}</td>
                <td className="py-1.5 pr-4">
                  <StatusCell status={r.status} />
                </td>
                <td className="py-1.5 pr-4 text-fg">{r.reason}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-fg-subtle">
                  {r.durationMs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-fg-muted">
        <span className="text-fg-subtle">Decision reason:</span> {verdict.decisionReason}
      </p>
    </div>
  );
}

function StatusCell({ status }: { status: "pass" | "fail" | "skip" | "error" }) {
  const cls =
    status === "pass"
      ? "text-accent-green"
      : status === "fail"
        ? "text-accent-red"
        : status === "error"
          ? "text-accent-amber"
          : "text-fg-dim";
  return (
    <span className={`font-mono text-[11px] uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

export const PoolRow = memo(PoolRowImpl);

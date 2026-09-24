import type { Position } from "@sniperbot/shared";
import type { HaltState } from "../risk/drawdown-circuit.js";
import type { DailySummary } from "./daily-summary.js";

/**
 * Telegram message builders. Pure functions — no env, no logger — so they are
 * unit-testable and the CLI can reuse them.
 *
 * Every message uses Telegram's HTML parse mode. Token names come from the
 * launch itself, which means an attacker picks them: anything that is not our
 * own markup goes through `escapeHtml`, or a coin named `<b>` makes Telegram
 * reject the whole message with "can't parse entities".
 */

export type Mode = "paper" | "live";

const MAX_LABEL_CHARS = 32;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Reverse of the markup we emit: used for the plain-text fallback send. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

// Control characters, zero-width characters and bidi overrides. A token named
// with U+202E renders its symbol backwards — a known way to spoof a ticker.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/**
 * A display name for a token: the symbol when it has one worth showing,
 * otherwise the shortened mint. Returned unescaped; callers escape.
 */
export function tokenLabel(symbol: string | null | undefined, mint: string): string {
  const clean = (symbol ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (!clean) return shortAddr(mint);
  // Array.from splits by code point, so an emoji is never cut in half.
  const chars = Array.from(clean);
  return chars.length > MAX_LABEL_CHARS ? `${chars.slice(0, MAX_LABEL_CHARS - 1).join("")}…` : clean;
}

export function usd(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

export function signedUsd(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  return n >= 0 ? `+${usd(n)}` : usd(n);
}

export function signedPct(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Memecoin prices span twelve orders of magnitude; pick a readable form. */
export function price(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "n/a";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toPrecision(4)}`;
  return `$${n.toExponential(3)}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function utcStamp(ts: number): string {
  const d = new Date(ts);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${month} ${hh}:${mm} UTC`;
}

/** Every message starts with the mode, so a paper alert is never mistaken for a live one. */
export function modeTag(mode: Mode): string {
  return mode === "live" ? "<b>🔴 LIVE</b>" : "<b>[PAPER]</b>";
}

function chartLink(poolAddress: string): string {
  return `<a href="https://dexscreener.com/solana/${escapeHtml(poolAddress)}">chart</a>`;
}

function realizedPct(p: Pick<Position, "realizedPnlUsd" | "entrySizeUsd">): number {
  return p.entrySizeUsd > 0 ? (p.realizedPnlUsd / p.entrySizeUsd) * 100 : 0;
}

export function positionOpened(p: Position, mode: Mode): string {
  const name = escapeHtml(tokenLabel(p.tokenSymbol, p.tokenMint));
  return [
    `🟢 ${modeTag(mode)} Bought <b>${name}</b>`,
    `${usd(p.entrySizeUsd)} at ${price(p.entryPriceUsd)} · score ${Math.round(p.filterScore)}`,
    `${escapeHtml(p.source)} · ${chartLink(p.poolAddress)} · <code>${escapeHtml(p.tokenMint)}</code>`,
  ].join("\n");
}

export function positionClosed(p: Position, mode: Mode): string {
  const name = escapeHtml(tokenLabel(p.tokenSymbol, p.tokenMint));
  const reason = p.closeReason ?? "closed";
  const head =
    reason === "rug-pull"
      ? `🚨 ${modeTag(mode)} <b>RUG</b> — sold <b>${name}</b>`
      : `${p.realizedPnlUsd > 0 ? "✅" : "🔻"} ${modeTag(mode)} Sold <b>${name}</b> · ${escapeHtml(reason)}`;
  const held = p.closedAt ? ` · held ${duration(p.closedAt - p.openedAt)}` : "";
  return [
    head,
    `<b>${signedUsd(p.realizedPnlUsd)}</b> (${signedPct(realizedPct(p))}) on ${usd(p.entrySizeUsd)} · peak ${signedPct(p.peakGainPct)}${held}`,
    chartLink(p.poolAddress),
  ].join("\n");
}

export function haltEngaged(state: HaltState, mode: Mode): string {
  return [
    `⛔ ${modeTag(mode)} <b>Trading halted</b> — ${escapeHtml(state.reason)}`,
    escapeHtml(state.detail),
    `New entries paused until ${utcStamp(state.untilTs)}. Open positions keep their exits.`,
  ].join("\n");
}

export function haltCleared(mode: Mode): string {
  return `▶️ ${modeTag(mode)} Halt cleared — new entries allowed again.`;
}

export interface EngineInfo {
  balanceUsd: number;
  openPositionCount: number;
  enabled: string[];
}

export function engineOnline(info: EngineInfo, mode: Mode): string {
  return [
    `⚙️ ${modeTag(mode)} Engine online · bankroll ${usd(info.balanceUsd)}`,
    `Alerts: ${info.enabled.length ? escapeHtml(info.enabled.join(", ")) : "none"}`,
  ].join("\n");
}

export function engineStopping(signal: string, openPositionCount: number, mode: Mode): string {
  const open =
    openPositionCount === 0
      ? "No open positions."
      : `⚠️ ${openPositionCount} open position${openPositionCount === 1 ? " is" : "s are"} no longer being managed.`;
  return `⚙️ ${modeTag(mode)} Engine stopping (${escapeHtml(signal)}). ${open}`;
}

export function droppedNote(n: number): string {
  return `⚠️ ${n} earlier alert${n === 1 ? " was" : "s were"} dropped while Telegram was backlogged — check the dashboard.`;
}

export interface SummaryContext {
  balanceUsd: number;
  openPositionCount: number;
  openExposureUsd: number;
  /** Set when the numbers could not come from the database. */
  coverageNote?: string;
}

export function dailySummary(s: DailySummary, ctx: SummaryContext, mode: Mode): string {
  const lines = [`📊 ${modeTag(mode)} <b>Daily report</b> · ${utcStamp(s.fromTs)} → ${utcStamp(s.toTs)}`];

  if (s.closed === 0) {
    lines.push("No positions closed in this window.");
  } else {
    lines.push(
      `Closed ${s.closed} · ${s.wins}W / ${s.losses}L · win rate ${s.winRatePct.toFixed(1)}%`,
      `Realized <b>${signedUsd(s.realizedPnlUsd)}</b> on ${usd(s.deployedUsd)} deployed (${signedPct(s.roiPct)})`,
      `Profit factor ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}`,
    );
    if (s.best) {
      lines.push(
        `Best: ${escapeHtml(tokenLabel(s.best.symbol, s.best.mint))} ${signedUsd(s.best.realizedPnlUsd)} · ${escapeHtml(s.best.closeReason ?? "closed")}`,
      );
    }
    if (s.worst) {
      lines.push(
        `Worst: ${escapeHtml(tokenLabel(s.worst.symbol, s.worst.mint))} ${signedUsd(s.worst.realizedPnlUsd)} · ${escapeHtml(s.worst.closeReason ?? "closed")}`,
      );
    }
    if (s.rugs > 0) lines.push(`Rug exits: ${s.rugs}`);
  }

  lines.push(
    `Now: ${ctx.openPositionCount} open (${usd(ctx.openExposureUsd)} exposure) · bankroll ${usd(ctx.balanceUsd)}`,
  );
  if (ctx.coverageNote) lines.push(`⚠️ ${escapeHtml(ctx.coverageNote)}`);
  return lines.join("\n");
}

export function testMessage(mode: Mode): string {
  return `✅ ${modeTag(mode)} Test alert from the sniper engine. If you can read this, alerts are wired correctly.`;
}

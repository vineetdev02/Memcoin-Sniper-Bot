import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type { Connection } from "@solana/web3.js";
import type { PoolEvent } from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { getRpcConnection } from "../state/rpc.js";
import { getEnabledTargets } from "./program-ids.js";
import { pumpFunLaunch } from "./parsers/pumpfun.js";
import type { PendingCreation } from "./pool-detector.js";

const log = childLogger("pumpportal");

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const MAX_RETRY_MS = 60_000;
const PING_EVERY_MS = 30_000;
const TRADES_NEED_KEY = /only available when connecting with an API key/i;

export interface PumpPortalWants {
  pumpfun: boolean;
  pumpswap: boolean;
}

/** One buy or sell on a pump.fun curve, from a token-trade subscription. */
export interface PumpPortalTrade {
  mint: string;
  trader: string;
  side: "buy" | "sell";
  sol: number;
  receivedAt: number;
}

/** What a launch's create message says beyond the pool itself, kept on the event. */
export interface PumpPortalLaunchInfo {
  name?: string;
  symbol?: string;
  // the creator's own buy in the create transaction
  devBuySol?: number;
}

export type PumpPortalItem =
  | { kind: "pool"; event: PoolEvent }
  | { kind: "trade"; trade: PumpPortalTrade }
  | { kind: "migration"; creation: PendingCreation }
  | { kind: "notice"; text: string };

/**
 * One PumpPortal message, read. A launch carries everything a pool event
 * needs, so it costs no RPC. A migration names only the token and the
 * transaction, so it is handed on to be parsed like a Helius log.
 *
 * `pool` says which launchpad: "pump" is pump.fun, "pump-amm" is PumpSwap.
 * LetsBonk launches ("bonk") and their Raydium migrations arrive on the same
 * subscriptions and are dropped: nothing downstream knows those pools.
 */
export function readPumpPortalMessage(
  text: string,
  receivedAt: number,
  wants: PumpPortalWants,
): PumpPortalItem | null {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    msg = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // Subscription acknowledgements, and the errors PumpPortal sends the same way.
  for (const key of ["message", "errors", "error"]) {
    const value = msg[key];
    if (typeof value === "string") return { kind: "notice", text: value };
  }

  const { signature, mint, txType, pool } = msg;
  if (typeof signature !== "string" || !BASE58_SIGNATURE.test(signature)) return null;
  if (typeof mint !== "string" || !BASE58_KEY.test(mint)) return null;

  if (txType === "create" && pool === "pump" && wants.pumpfun) {
    const creator = msg.traderPublicKey;
    if (typeof creator !== "string" || !BASE58_KEY.test(creator)) return null;
    const info: PumpPortalLaunchInfo = {
      name: typeof msg.name === "string" ? msg.name.slice(0, 64) : undefined,
      symbol: typeof msg.symbol === "string" ? msg.symbol.slice(0, 16) : undefined,
      devBuySol: typeof msg.solAmount === "number" && Number.isFinite(msg.solAmount) ? msg.solAmount : undefined,
    };
    return { kind: "pool", event: { ...pumpFunLaunch(mint, creator, signature, receivedAt), rawEvent: info } };
  }
  if ((txType === "buy" || txType === "sell") && pool === "pump") {
    const trader = msg.traderPublicKey;
    const sol = msg.solAmount;
    if (typeof trader !== "string" || !BASE58_KEY.test(trader)) return null;
    if (typeof sol !== "number" || !Number.isFinite(sol)) return null;
    return { kind: "trade", trade: { mint, trader, side: txType, sol, receivedAt } };
  }
  if (txType === "migrate" && pool === "pump-amm" && wants.pumpswap) {
    return { kind: "migration", creation: { signature, source: "pumpswap", receivedAt } };
  }
  return null;
}

interface PumpPortalStreamEvents {
  pool: (event: PoolEvent) => void;
  trade: (trade: PumpPortalTrade) => void;
  log: (creation: PendingCreation) => void;
}

export declare interface PumpPortalStream {
  on<E extends keyof PumpPortalStreamEvents>(event: E, listener: PumpPortalStreamEvents[E]): this;
  emit<E extends keyof PumpPortalStreamEvents>(
    event: E,
    ...args: Parameters<PumpPortalStreamEvents[E]>
  ): boolean;
}

/**
 * New pump.fun launches and PumpSwap migrations from PumpPortal's free data
 * feed. It sends those events and nothing else, where a Helius log
 * subscription to the same programs delivers every trade on them too, and
 * Helius bills WebSocket traffic by the megabyte. PumpPortal asks for a single
 * connection per client, so both subscriptions share one, and reconnects
 * back off rather than retry in a loop.
 */
export class PumpPortalStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private wanted = false;
  private open = false;
  private retries = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly wants: PumpPortalWants;
  // token-trade subscriptions to restore after a reconnect
  private readonly watched = new Set<string>();
  // PumpPortal serves token trades only to a funded API key, and says so per subscribe
  private tradesLocked = false;

  constructor() {
    super();
    this.wants = { pumpfun: env.ENABLE_PUMPFUN, pumpswap: env.ENABLE_PUMPSWAP };
    const unserved = getEnabledTargets()
      .map((t) => t.source)
      .filter((s) => s !== "pumpfun" && s !== "pumpswap");
    if (unserved.length > 0) {
      log.warn(
        { sources: unserved },
        "enabled, but PumpPortal does not carry them — POOL_FEED=helius does, at Helius WebSocket rates",
      );
    }
  }

  isReady(): boolean {
    return this.open;
  }

  /** False once PumpPortal has refused token-trade subscriptions on this connection's key. */
  tradesAvailable(): boolean {
    return !this.tradesLocked;
  }

  /** Every buy and sell on these tokens arrives as a "trade" event, on the same connection. */
  watchTrades(mints: string[]): void {
    if (this.tradesLocked) return;
    for (const m of mints) this.watched.add(m);
    this.send({ method: "subscribeTokenTrade", keys: mints });
  }

  unwatchTrades(mints: string[]): void {
    if (this.tradesLocked) return;
    for (const m of mints) this.watched.delete(m);
    this.send({ method: "unsubscribeTokenTrade", keys: mints });
  }

  private send(msg: object): void {
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Migrations are parsed from their transaction, on the same RPC the filters use. */
  getConnection(): Connection | null {
    return getRpcConnection();
  }

  /** Resolves once connected, or after the first attempt fails; retries carry on behind it. */
  async start(): Promise<void> {
    if (this.wanted) {
      log.warn("Already started");
      return;
    }
    if (!this.wants.pumpfun && !this.wants.pumpswap) {
      log.warn("ENABLE_PUMPFUN and ENABLE_PUMPSWAP are both off — PumpPortal has nothing to send");
      return;
    }
    this.wanted = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      setTimeout(resolve, 2_000).unref();
      ws.close();
    });
    log.info("Stopped");
  }

  private connect(): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(env.PUMPPORTAL_WS_URL);
      this.ws = ws;
      let alive = true;

      ws.on("open", () => {
        this.open = true;
        this.retries = 0;
        if (this.wants.pumpfun) ws.send(JSON.stringify({ method: "subscribeNewToken" }));
        if (this.wants.pumpswap) ws.send(JSON.stringify({ method: "subscribeMigration" }));
        if (this.watched.size > 0) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [...this.watched] }));
        // A connection that died without a close frame would otherwise just go quiet.
        this.pingTimer = setInterval(() => {
          if (!alive) {
            log.warn("PumpPortal stopped answering pings — reconnecting");
            ws.terminate();
            return;
          }
          alive = false;
          ws.ping();
        }, PING_EVERY_MS);
        log.info({ newTokens: this.wants.pumpfun, migrations: this.wants.pumpswap }, "PumpPortal stream live");
        resolve();
      });
      ws.on("pong", () => {
        alive = true;
      });
      ws.on("message", (data) => {
        alive = true;
        this.handle(data.toString());
      });
      // Always followed by "close", which decides whether to retry.
      ws.on("error", (err) => log.warn({ err: err.message }, "PumpPortal socket error"));
      ws.on("close", (code) => {
        this.open = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (this.ws === ws) this.ws = null;
        resolve();
        if (this.wanted) this.scheduleReconnect(code);
      });
    });
  }

  private scheduleReconnect(code: number): void {
    const delayMs = Math.min(1_000 * 2 ** this.retries, MAX_RETRY_MS);
    this.retries++;
    log.warn({ code, retryInMs: delayMs }, "PumpPortal disconnected");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted) void this.connect();
    }, delayMs);
  }

  private handle(text: string): void {
    const item = readPumpPortalMessage(text, Date.now(), this.wants);
    if (!item) return;
    if (item.kind === "notice" && TRADES_NEED_KEY.test(item.text)) {
      if (!this.tradesLocked) {
        log.warn(
          "PumpPortal serves token trades only to an API key funded with 0.02 SOL — the launch tape is off. Put the key in PUMPPORTAL_WS_URL to turn it on.",
        );
      }
      this.tradesLocked = true;
      this.watched.clear();
    } else if (item.kind === "notice") log.info({ notice: item.text }, "PumpPortal");
    else if (item.kind === "pool") this.emit("pool", item.event);
    else if (item.kind === "trade") this.emit("trade", item.trade);
    else this.emit("log", item.creation);
  }
}

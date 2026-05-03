import { Connection, type Context, type Logs } from "@solana/web3.js";
import { EventEmitter } from "node:events";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { getEnabledTargets, type ProgramTarget } from "./program-ids.js";
import type { DexSource } from "@sniperbot/shared";

const log = childLogger("helius-ws");

export interface RawLogEvent {
  signature: string;
  slot: number;
  source: DexSource;
  programId: string;
  logs: string[];
  receivedAt: number;
}

interface HeliusLogStreamEvents {
  log: (event: RawLogEvent) => void;
  ready: () => void;
  error: (err: Error) => void;
}

export declare interface HeliusLogStream {
  on<E extends keyof HeliusLogStreamEvents>(event: E, listener: HeliusLogStreamEvents[E]): this;
  emit<E extends keyof HeliusLogStreamEvents>(
    event: E,
    ...args: Parameters<HeliusLogStreamEvents[E]>
  ): boolean;
}

export class HeliusLogStream extends EventEmitter {
  private connection: Connection | null = null;
  private subscriptionIds: number[] = [];
  private readonly targets: ProgramTarget[];
  private started = false;
  private dedupeWindow = new Map<string, number>();
  private readonly DEDUPE_TTL_MS = 60_000;

  constructor() {
    super();
    this.targets = getEnabledTargets();
  }

  isReady(): boolean {
    return this.started && this.subscriptionIds.length > 0;
  }

  getConnection(): Connection | null {
    return this.connection;
  }

  async start(): Promise<void> {
    if (this.started) {
      log.warn("Already started");
      return;
    }
    if (!env.HELIUS_API_KEY) {
      log.warn(
        "HELIUS_API_KEY is empty — Helius log stream not starting. Use SYNTHETIC_FEED=true for pipeline testing.",
      );
      return;
    }
    if (this.targets.length === 0) {
      log.warn("No DEX sources enabled in env");
      return;
    }

    const rpcUrl = env.HELIUS_RPC_URL.endsWith("=")
      ? `${env.HELIUS_RPC_URL}${env.HELIUS_API_KEY}`
      : env.HELIUS_RPC_URL;
    const wsUrl = env.HELIUS_WS_URL.endsWith("=")
      ? `${env.HELIUS_WS_URL}${env.HELIUS_API_KEY}`
      : env.HELIUS_WS_URL;

    this.connection = new Connection(rpcUrl, {
      wsEndpoint: wsUrl,
      commitment: "processed",
    });

    log.info(
      { sources: this.targets.map((t) => t.source) },
      "Subscribing to logs for enabled DEX programs",
    );

    for (const target of this.targets) {
      try {
        const id = this.connection.onLogs(
          target.programId,
          (logs: Logs, ctx: Context) => this.handleLog(target, logs, ctx),
          "processed",
        );
        this.subscriptionIds.push(id);
        log.info(
          {
            source: target.source,
            programId: target.programId.toBase58(),
            subId: id,
            description: target.description,
          },
          "subscribed",
        );
      } catch (err) {
        log.error({ err, source: target.source }, "Subscribe failed");
        this.emit("error", err as Error);
      }
    }

    this.started = true;
    setInterval(() => this.cleanupDedupe(), this.DEDUPE_TTL_MS);
    this.emit("ready");
    log.info({ subscriptions: this.subscriptionIds.length }, "Helius log stream live");
  }

  private handleLog(target: ProgramTarget, logs: Logs, ctx: Context): void {
    if (logs.err) return;
    if (this.dedupeWindow.has(logs.signature)) return;

    const matches = target.creationMarkers.some((marker) =>
      logs.logs.some((line) => line.includes(marker)),
    );
    if (!matches) return;

    this.dedupeWindow.set(logs.signature, Date.now());

    const event: RawLogEvent = {
      signature: logs.signature,
      slot: ctx.slot,
      source: target.source,
      programId: target.programId.toBase58(),
      logs: logs.logs,
      receivedAt: Date.now(),
    };

    this.emit("log", event);
  }

  private cleanupDedupe(): void {
    const cutoff = Date.now() - this.DEDUPE_TTL_MS;
    for (const [sig, t] of this.dedupeWindow) {
      if (t < cutoff) this.dedupeWindow.delete(sig);
    }
  }

  async stop(): Promise<void> {
    if (!this.connection) return;
    for (const id of this.subscriptionIds) {
      try {
        await this.connection.removeOnLogsListener(id);
      } catch (err) {
        log.warn({ err, id }, "Failed to remove subscription");
      }
    }
    this.subscriptionIds = [];
    this.started = false;
    log.info("Stopped");
  }
}

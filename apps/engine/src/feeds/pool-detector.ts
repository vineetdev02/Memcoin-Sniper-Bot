import { EventEmitter } from "node:events";
import PQueue from "p-queue";
import type { Connection } from "@solana/web3.js";
import type { PoolEvent, DexSource } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { HeliusLogStream, type RawLogEvent } from "./helius-ws.js";
import { getParser } from "./parsers/index.js";
import { publishPoolEvent } from "../state/pool-stream.js";
import { getPrisma } from "../state/db.js";

const log = childLogger("pool-detector");

interface PoolDetectorEvents {
  pool: (event: PoolEvent) => void;
}

export declare interface PoolDetector {
  on<E extends keyof PoolDetectorEvents>(event: E, listener: PoolDetectorEvents[E]): this;
  emit<E extends keyof PoolDetectorEvents>(
    event: E,
    ...args: Parameters<PoolDetectorEvents[E]>
  ): boolean;
}

const dexSourceToPrisma: Record<DexSource, string> = {
  pumpfun: "pumpfun",
  pumpswap: "pumpswap",
  "raydium-amm": "raydium_amm",
  "raydium-clmm": "raydium_clmm",
  "raydium-launchpad": "raydium_launchpad",
  meteora: "meteora",
  orca: "orca",
};

export class PoolDetector extends EventEmitter {
  private readonly stream: HeliusLogStream;
  private readonly queue = new PQueue({ concurrency: 5, intervalCap: 20, interval: 1000 });
  private parsedCount = 0;
  private skippedCount = 0;

  constructor(stream: HeliusLogStream) {
    super();
    this.stream = stream;
    this.stream.on("log", (raw) => this.handleRawLog(raw));
  }

  /**
   * Inject a pre-parsed pool event (used by the synthetic feed in dev/testing).
   */
  async ingest(event: PoolEvent): Promise<void> {
    await this.persistAndPublish(event);
  }

  getStats() {
    return {
      parsed: this.parsedCount,
      skipped: this.skippedCount,
      queued: this.queue.size,
    };
  }

  private handleRawLog(raw: RawLogEvent): void {
    const conn = this.stream.getConnection();
    if (!conn) return;
    void this.queue.add(() => this.processLog(raw, conn));
  }

  private async processLog(raw: RawLogEvent, conn: Connection): Promise<void> {
    const parser = getParser(raw.source);
    if (!parser) {
      this.skippedCount++;
      return;
    }

    const event = await parser(raw.signature, raw.receivedAt, conn);
    if (!event) {
      this.skippedCount++;
      return;
    }

    await this.persistAndPublish(event);
  }

  private async persistAndPublish(event: PoolEvent): Promise<void> {
    this.parsedCount++;

    try {
      const prisma = getPrisma();
      await prisma.pool.upsert({
        where: { poolAddress: event.poolAddress },
        create: {
          poolAddress: event.poolAddress,
          tokenMint: event.tokenMint,
          baseMint: event.baseMint,
          // @ts-expect-error - prisma enum union widened by generator
          source: dexSourceToPrisma[event.source],
          initialLiquidityUsd: event.initialLiquidityUsd,
          initialPriceUsd: event.initialPriceUsd,
          creatorWallet: event.creatorWallet,
          detectedAt: new Date(event.detectedAt),
          signature: event.signature,
        },
        update: {},
      });
    } catch (err) {
      log.warn({ err, signature: event.signature }, "Pool persist failed (continuing)");
    }

    await publishPoolEvent(event);
    this.emit("pool", event);

    log.info(
      {
        source: event.source,
        mint: `${event.tokenMint.slice(0, 4)}…${event.tokenMint.slice(-4)}`,
        liqUsd: event.initialLiquidityUsd.toFixed(0),
        priceUsd: event.initialPriceUsd.toExponential(3),
        sig: `${event.signature.slice(0, 8)}…`,
      },
      "POOL DETECTED",
    );
  }
}

import type { PoolEvent, DexSource } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import type { PoolDetector } from "./pool-detector.js";

const log = childLogger("synthetic-feed");

const SOURCES: DexSource[] = ["pumpfun", "pumpswap", "raydium-amm"];

const TOKEN_NAMES = [
  "BONK", "WIF", "POPCAT", "MEW", "BOME", "PNUT", "GOAT", "MOG", "MEME", "TRUMP",
  "PEPE", "FLOKI", "DOGE", "SHIB", "BRETT", "TURBO", "MOODENG", "FWOG", "RETARDIO",
];

const ADJ = ["MEGA", "GIGA", "TURBO", "ULTRA", "HYPER", "SAFE", "BABY", "KING", "MOON", "ROCKET"];

function randomMint(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 44; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function randomSignature(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 88; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function randomTokenName(): string {
  if (Math.random() < 0.5) {
    const name = TOKEN_NAMES[Math.floor(Math.random() * TOKEN_NAMES.length)];
    return name ?? "TOKEN";
  }
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const name = TOKEN_NAMES[Math.floor(Math.random() * TOKEN_NAMES.length)];
  return `${adj}${name}`;
}

function generateEvent(): PoolEvent {
  const source = SOURCES[Math.floor(Math.random() * SOURCES.length)] ?? "pumpfun";
  const liq = Math.floor(Math.random() * 80_000) + 2_000;
  const price = liq / (Math.random() * 5 + 1) / 1_000_000;
  return {
    poolAddress: randomMint(),
    tokenMint: randomMint(),
    baseMint: "So11111111111111111111111111111111111111112",
    source,
    initialLiquidityUsd: liq,
    initialPriceUsd: price,
    creatorWallet: randomMint(),
    detectedAt: Date.now(),
    signature: randomSignature(),
    rawEvent: { synthetic: true, name: randomTokenName() },
  };
}

export class SyntheticFeed {
  private timer: NodeJS.Timeout | null = null;
  private readonly detector: PoolDetector;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(detector: PoolDetector, minDelayMs = 2000, maxDelayMs = 5000) {
    this.detector = detector;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  start(): void {
    log.warn(
      { minDelayMs: this.minDelayMs, maxDelayMs: this.maxDelayMs },
      "SYNTHETIC FEED ACTIVE — generating fake pool events for pipeline testing",
    );
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    const delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    this.timer = setTimeout(async () => {
      try {
        await this.detector.ingest(generateEvent());
      } catch (err) {
        log.error({ err }, "synthetic ingest failed");
      }
      this.scheduleNext();
    }, delay);
  }
}

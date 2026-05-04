import type { PoolEvent, DexSource } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import type { PoolDetector } from "./pool-detector.js";
import type { SyntheticMock } from "../filters/types.js";

const log = childLogger("synthetic-feed");

const SOURCES: DexSource[] = ["pumpfun", "pumpswap", "raydium-amm"];

const TOKEN_NAMES = [
  "BONK", "WIF", "POPCAT", "MEW", "BOME", "PNUT", "GOAT", "MOG", "MEME", "TRUMP",
  "PEPE", "FLOKI", "DOGE", "SHIB", "BRETT", "TURBO", "MOODENG", "FWOG", "RETARDIO",
];
const ADJ = ["MEGA", "GIGA", "TURBO", "ULTRA", "HYPER", "SAFE", "BABY", "KING", "MOON"];

function randomMint(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 44; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randomSignature(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 88; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randomTokenName(): string {
  if (Math.random() < 0.5) return TOKEN_NAMES[Math.floor(Math.random() * TOKEN_NAMES.length)] ?? "TOKEN";
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}${TOKEN_NAMES[Math.floor(Math.random() * TOKEN_NAMES.length)]}`;
}

/**
 * Quality buckets:
 *   PRISTINE  10% — passes everything (rare but real)
 *   SOLID     20% — minor issues (skip-able)
 *   MIXED     35% — one or two filter fails
 *   SKETCHY   25% — multiple fails
 *   RUG       10% — honeypot or bundled launch (instant reject)
 */
type Bucket = "PRISTINE" | "SOLID" | "MIXED" | "SKETCHY" | "RUG";

function pickBucket(): Bucket {
  const r = Math.random();
  if (r < 0.10) return "PRISTINE";
  if (r < 0.30) return "SOLID";
  if (r < 0.65) return "MIXED";
  if (r < 0.90) return "SKETCHY";
  return "RUG";
}

function generateMock(bucket: Bucket): SyntheticMock {
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  switch (bucket) {
    case "PRISTINE":
      return {
        mintAuthRenounced: true,
        freezeAuthRenounced: true,
        lpStatus: Math.random() < 0.6 ? "burned" : "locked",
        topHolderPct: rand(2, 8),
        top10HoldersPct: rand(15, 30),
        devRugRate: rand(0, 0.1),
        devLaunchCount: Math.floor(rand(2, 30)),
        honeypotSafe: true,
        sellTaxPct: 0,
        bundledLaunch: false,
        insiderFunded: false,
        socialScore: Math.floor(rand(60, 95)),
        earlyTxCount: Math.floor(rand(0, 5)),
        buySellRatio: rand(1.5, 3.5),
      };
    case "SOLID":
      return {
        mintAuthRenounced: true,
        freezeAuthRenounced: true,
        lpStatus: "burned",
        topHolderPct: rand(5, 14),
        top10HoldersPct: rand(20, 38),
        devRugRate: rand(0.05, 0.25),
        devLaunchCount: Math.floor(rand(3, 25)),
        honeypotSafe: true,
        sellTaxPct: rand(0, 4),
        bundledLaunch: false,
        insiderFunded: false,
        socialScore: Math.floor(rand(40, 75)),
        earlyTxCount: Math.floor(rand(0, 8)),
        buySellRatio: rand(1.0, 2.5),
      };
    case "MIXED":
      return {
        mintAuthRenounced: Math.random() < 0.7,
        freezeAuthRenounced: Math.random() < 0.6,
        lpStatus: Math.random() < 0.6 ? "locked" : "unlocked",
        topHolderPct: rand(8, 22),
        top10HoldersPct: rand(30, 55),
        devRugRate: rand(0.1, 0.45),
        devLaunchCount: Math.floor(rand(2, 40)),
        honeypotSafe: true,
        sellTaxPct: rand(0, 12),
        bundledLaunch: Math.random() < 0.15,
        insiderFunded: Math.random() < 0.2,
        socialScore: Math.floor(rand(20, 60)),
        earlyTxCount: Math.floor(rand(3, 18)),
        buySellRatio: rand(0.6, 1.8),
      };
    case "SKETCHY":
      return {
        mintAuthRenounced: Math.random() < 0.4,
        freezeAuthRenounced: Math.random() < 0.4,
        lpStatus: "unlocked",
        topHolderPct: rand(15, 35),
        top10HoldersPct: rand(45, 75),
        devRugRate: rand(0.3, 0.7),
        devLaunchCount: Math.floor(rand(5, 80)),
        honeypotSafe: true,
        sellTaxPct: rand(2, 18),
        bundledLaunch: Math.random() < 0.4,
        insiderFunded: Math.random() < 0.35,
        socialScore: Math.floor(rand(0, 35)),
        earlyTxCount: Math.floor(rand(8, 25)),
        buySellRatio: rand(0.3, 1.3),
      };
    case "RUG":
      return {
        mintAuthRenounced: Math.random() < 0.3,
        freezeAuthRenounced: Math.random() < 0.3,
        lpStatus: "unlocked",
        topHolderPct: rand(20, 60),
        top10HoldersPct: rand(60, 95),
        devRugRate: rand(0.6, 0.95),
        devLaunchCount: Math.floor(rand(20, 200)),
        honeypotSafe: Math.random() > 0.6, // ~40% are honeypots outright
        sellTaxPct: Math.random() < 0.5 ? rand(0, 5) : rand(15, 99),
        bundledLaunch: true,
        insiderFunded: true,
        socialScore: Math.floor(rand(0, 20)),
        earlyTxCount: Math.floor(rand(15, 50)),
        buySellRatio: rand(0.1, 0.9),
      };
  }
}

function generateEvent(): PoolEvent {
  const source = SOURCES[Math.floor(Math.random() * SOURCES.length)] ?? "pumpfun";
  const liq = Math.floor(Math.random() * 80_000) + 2_000;
  const price = liq / (Math.random() * 5 + 1) / 1_000_000;
  const bucket = pickBucket();
  const mock = generateMock(bucket);

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
    rawEvent: { synthetic: true, name: randomTokenName(), bucket, mock },
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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

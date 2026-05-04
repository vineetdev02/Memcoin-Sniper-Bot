import type { PoolEvent } from "@sniperbot/shared";

export type Bucket = "PRISTINE" | "SOLID" | "MIXED" | "SKETCHY" | "RUG";

export interface PriceProfile {
  bucket: Bucket;
  entryPriceUsd: number;
  openedAt: number;
  peakMultiplier: number;
  peakAtMs: number;
  finalMultiplier: number;
  finalAtMs: number;
  rugAt: number | null;
  volatility: number;
  liquidityUsd: number;
  liquidityAfterRug: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function extractBucket(pool: PoolEvent): Bucket {
  const raw = pool.rawEvent as { bucket?: Bucket } | undefined;
  return raw?.bucket ?? "MIXED";
}

export function buildProfile(pool: PoolEvent, openedAt: number, entryPriceUsd: number): PriceProfile {
  const bucket = extractBucket(pool);
  const liquidityUsd = pool.initialLiquidityUsd;
  const min = 60_000; // 1 minute in ms

  switch (bucket) {
    case "PRISTINE":
      return {
        bucket, entryPriceUsd, openedAt, liquidityUsd,
        peakMultiplier: rand(5, 50),
        peakAtMs: rand(5 * min, 30 * min),
        finalMultiplier: rand(2, 8),
        finalAtMs: 90 * min,
        rugAt: null,
        volatility: 0.10,
        liquidityAfterRug: liquidityUsd,
      };
    case "SOLID":
      return {
        bucket, entryPriceUsd, openedAt, liquidityUsd,
        peakMultiplier: rand(1.8, 4),
        peakAtMs: rand(2 * min, 15 * min),
        finalMultiplier: rand(0.8, 2),
        finalAtMs: 60 * min,
        rugAt: null,
        volatility: 0.08,
        liquidityAfterRug: liquidityUsd,
      };
    case "MIXED": {
      const willRug = Math.random() < 0.15;
      return {
        bucket, entryPriceUsd, openedAt, liquidityUsd,
        peakMultiplier: rand(0.9, 1.8),
        peakAtMs: rand(1 * min, 8 * min),
        finalMultiplier: rand(0.3, 0.9),
        finalAtMs: 30 * min,
        rugAt: willRug ? rand(2 * min, 15 * min) : null,
        volatility: 0.12,
        liquidityAfterRug: liquidityUsd * 0.05,
      };
    }
    case "SKETCHY": {
      const willRug = Math.random() < 0.45;
      return {
        bucket, entryPriceUsd, openedAt, liquidityUsd,
        peakMultiplier: rand(0.8, 1.4),
        peakAtMs: rand(30_000, 4 * min),
        finalMultiplier: rand(0.10, 0.50),
        finalAtMs: 20 * min,
        rugAt: willRug ? rand(60_000, 10 * min) : null,
        volatility: 0.15,
        liquidityAfterRug: liquidityUsd * 0.03,
      };
    }
    case "RUG":
      return {
        bucket, entryPriceUsd, openedAt, liquidityUsd,
        peakMultiplier: rand(0.95, 1.3),
        peakAtMs: rand(15_000, 90_000),
        finalMultiplier: rand(0.02, 0.08),
        finalAtMs: 5 * min,
        rugAt: rand(60_000, 4 * min),
        volatility: 0.18,
        liquidityAfterRug: liquidityUsd * 0.02,
      };
  }
}

/**
 * Returns price at sim-time `tMs` (ms since position opened).
 * Curve: ramp to peak, decay to final, plus sinusoidal noise.
 * Hard rug drops price ~95% instantly at rugAt.
 */
export function priceAt(profile: PriceProfile, tMs: number): number {
  if (tMs < 0) tMs = 0;

  if (profile.rugAt !== null && tMs >= profile.rugAt) {
    const jitter = 1 + (Math.sin(tMs / 1500) * 0.02);
    const rugMult = profile.finalMultiplier * jitter;
    return profile.entryPriceUsd * Math.max(0.001, rugMult);
  }

  let multiplier: number;
  if (tMs <= profile.peakAtMs) {
    const t = tMs / profile.peakAtMs;
    const eased = Math.pow(t, 0.7); // front-loaded ramp
    multiplier = 1 + (profile.peakMultiplier - 1) * eased;
  } else {
    const span = Math.max(1, profile.finalAtMs - profile.peakAtMs);
    const t = Math.min(1, (tMs - profile.peakAtMs) / span);
    multiplier = profile.peakMultiplier + (profile.finalMultiplier - profile.peakMultiplier) * t;
  }

  const noise = 1 + Math.sin(tMs / 4000) * profile.volatility * 0.5
    + Math.sin(tMs / 1100) * profile.volatility * 0.3
    + (Math.random() - 0.5) * profile.volatility * 0.2;

  return profile.entryPriceUsd * multiplier * Math.max(0.05, noise);
}

export function liquidityAt(profile: PriceProfile, tMs: number): number {
  if (profile.rugAt !== null && tMs >= profile.rugAt) {
    return profile.liquidityAfterRug;
  }
  return profile.liquidityUsd;
}

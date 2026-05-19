import type { Filter } from "./types.js";
import { makeResult } from "./types.js";
import { fetchPair } from "../feeds/dexscreener-client.js";

const MIN_SCORE = 30;

// Weights sum to 100 if everything is present.
const W_WEBSITE = 30;
const W_TWITTER = 30;
const W_TELEGRAM = 20;
const W_BOOST = 20;

function scorePair(pair: Awaited<ReturnType<typeof fetchPair>>): {
  score: number;
  channels: Record<string, boolean>;
} {
  if (!pair) return { score: 0, channels: { website: false, twitter: false, telegram: false, boosted: false } };

  const socials = pair.info?.socials ?? [];
  const websites = pair.info?.websites ?? [];
  const hasWebsite = websites.length > 0;
  const hasTwitter = socials.some((s) => /twitter|x/i.test(s.type));
  const hasTelegram = socials.some((s) => /telegram/i.test(s.type));
  const boosted = (pair.boosts?.active ?? 0) > 0;

  let score = 0;
  if (hasWebsite) score += W_WEBSITE;
  if (hasTwitter) score += W_TWITTER;
  if (hasTelegram) score += W_TELEGRAM;
  if (boosted) score += W_BOOST;

  return { score, channels: { website: hasWebsite, twitter: hasTwitter, telegram: hasTelegram, boosted } };
}

export const socialSignalFilter: Filter = {
  id: "social-signal",
  weight: 3,
  enabled: true,
  async evaluate(pool, ctx) {
    const start = Date.now();

    if (ctx.isSynthetic && ctx.syntheticMock) {
      const score = ctx.syntheticMock.socialScore;
      const ok = score >= MIN_SCORE;
      return makeResult(
        "social-signal",
        ok ? "pass" : "fail",
        `social score ${score}/100`,
        { score, metadata: { socialScore: score }, durationMs: Date.now() - start },
      );
    }

    const pair = await fetchPair(pool.poolAddress);
    if (!pair) {
      // No DexScreener entry yet — treat as low-confidence pass so the filter
      // doesn't gate everything just for being fresh
      return makeResult("social-signal", "skip", "DexScreener has no pair data yet", {
        durationMs: Date.now() - start,
      });
    }

    const { score, channels } = scorePair(pair);
    const ok = score >= MIN_SCORE;
    return makeResult(
      "social-signal",
      ok ? "pass" : "fail",
      ok
        ? `social score ${score}/100 [${Object.entries(channels).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}]`
        : `social score ${score}/100 < min ${MIN_SCORE}`,
      {
        score,
        metadata: { socialScore: score, channels, boostsActive: pair.boosts?.active ?? 0 },
        durationMs: Date.now() - start,
      },
    );
  },
};

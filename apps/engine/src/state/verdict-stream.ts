import type { OrchestratorVerdict } from "@sniperbot/shared";
import { getRedis } from "./redis.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("verdict-stream");

export const VERDICT_STREAM_KEY = "stream:verdicts";
const STREAM_MAXLEN = 5000;

export async function publishVerdict(verdict: OrchestratorVerdict): Promise<void> {
  const redis = getRedis();
  const payload = JSON.stringify(verdict);
  try {
    await redis.xadd(
      VERDICT_STREAM_KEY,
      "MAXLEN",
      "~",
      STREAM_MAXLEN.toString(),
      "*",
      "verdict",
      payload,
    );
  } catch (err) {
    log.error({ err, sig: verdict.signature }, "verdict publish failed");
  }
}

export async function getRecentVerdicts(limit = 50): Promise<OrchestratorVerdict[]> {
  const redis = getRedis();
  try {
    const entries = await redis.xrevrange(VERDICT_STREAM_KEY, "+", "-", "COUNT", limit);
    return entries
      .map(([, fields]) => {
        const payload = fields[1];
        if (!payload) return null;
        try {
          return JSON.parse(payload) as OrchestratorVerdict;
        } catch {
          return null;
        }
      })
      .filter((v): v is OrchestratorVerdict => v !== null);
  } catch (err) {
    log.error({ err }, "failed to read recent verdicts");
    return [];
  }
}

import type { PoolEvent } from "@sniperbot/shared";
import { getRedis } from "./redis.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("pool-stream");

export const POOL_STREAM_KEY = "stream:new-pools";
export const POOL_CHANNEL = "channel:new-pools";
const STREAM_MAXLEN = 5000;

export async function publishPoolEvent(event: PoolEvent): Promise<void> {
  const redis = getRedis();
  const payload = JSON.stringify(event);

  try {
    await redis
      .multi()
      .xadd(
        POOL_STREAM_KEY,
        "MAXLEN",
        "~",
        STREAM_MAXLEN.toString(),
        "*",
        "event",
        payload,
      )
      .publish(POOL_CHANNEL, payload)
      .exec();
  } catch (err) {
    log.error({ err, signature: event.signature }, "failed to publish pool event");
  }
}

export async function getRecentPools(limit = 50): Promise<PoolEvent[]> {
  const redis = getRedis();
  try {
    const entries = await redis.xrevrange(POOL_STREAM_KEY, "+", "-", "COUNT", limit);
    return entries
      .map(([, fields]) => {
        const payload = fields[1];
        if (!payload) return null;
        try {
          return JSON.parse(payload) as PoolEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is PoolEvent => e !== null);
  } catch (err) {
    log.error({ err }, "failed to read recent pools");
    return [];
  }
}

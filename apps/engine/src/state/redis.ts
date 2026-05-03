import Redis from "ioredis";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("redis");

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on("connect", () => log.info("connected"));
  client.on("ready", () => log.info("ready"));
  client.on("error", (err) => log.error({ err }, "error"));
  client.on("close", () => log.warn("connection closed"));
  client.on("reconnecting", (ms: number) => log.warn({ ms }, "reconnecting"));

  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    const reply = await r.ping();
    return reply === "PONG";
  } catch (err) {
    log.error({ err }, "ping failed");
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    log.info("closed");
  }
}

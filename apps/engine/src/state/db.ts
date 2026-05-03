import { PrismaClient } from "@prisma/client";
import { childLogger } from "../utils/logger.js";

const log = childLogger("prisma");

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (client) return client;
  client = new PrismaClient({
    log: [
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
    ],
  });
  // @ts-expect-error - prisma typing for $on event variants is loose
  client.$on("warn", (e) => log.warn({ event: e }, "prisma warning"));
  // @ts-expect-error - same as above
  client.$on("error", (e) => log.error({ event: e }, "prisma error"));
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

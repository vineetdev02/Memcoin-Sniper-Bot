import { env, isPaperMode } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { closeRedis, pingRedis } from "./state/redis.js";
import { disconnectPrisma, getPrisma } from "./state/db.js";
import { HeliusLogStream } from "./feeds/helius-ws.js";
import { PoolDetector } from "./feeds/pool-detector.js";
import { SyntheticFeed } from "./feeds/synthetic-feed.js";
import { SocketServer } from "./api/socket-server.js";

async function main() {
  logger.info(
    {
      mode: env.MODE,
      logLevel: env.LOG_LEVEL,
      nodeEnv: env.NODE_ENV,
      syntheticFeed: env.SYNTHETIC_FEED,
      enabledDexes: {
        pumpfun: env.ENABLE_PUMPFUN,
        pumpswap: env.ENABLE_PUMPSWAP,
        raydiumAmm: env.ENABLE_RAYDIUM_AMM,
        raydiumClmm: env.ENABLE_RAYDIUM_CLMM,
        raydiumLaunchpad: env.ENABLE_RAYDIUM_LAUNCHPAD,
        meteora: env.ENABLE_METEORA,
        orca: env.ENABLE_ORCA,
      },
    },
    "Sniper engine booting",
  );

  if (isPaperMode) {
    logger.info(
      { startingBalanceUsd: env.PAPER_STARTING_BALANCE_USD },
      "PAPER MODE — no real funds at risk",
    );
  } else {
    logger.warn(
      { liveMaxBankrollUsd: env.LIVE_MAX_BANKROLL_USD },
      "LIVE MODE — real funds at risk",
    );
  }

  // === Infra checks ===
  const redisOk = await pingRedis();
  if (!redisOk) {
    logger.fatal("Redis ping failed. Is docker compose up?");
    process.exit(1);
  }
  logger.info("Redis: OK");

  try {
    await getPrisma().$queryRaw`SELECT 1`;
    logger.info("Postgres: OK");
  } catch (err) {
    logger.fatal({ err }, "Postgres connection failed");
    process.exit(1);
  }

  // === Pool detection pipeline ===
  const stream = new HeliusLogStream();
  const detector = new PoolDetector(stream);

  detector.on("pool", (event) => {
    // Stats are logged by detector itself; hook is here for future wiring
    void event;
  });

  await stream.start();

  let synthetic: SyntheticFeed | null = null;
  if (env.SYNTHETIC_FEED) {
    synthetic = new SyntheticFeed(detector, env.SYNTHETIC_FEED_MIN_MS, env.SYNTHETIC_FEED_MAX_MS);
    synthetic.start();
  } else if (!env.HELIUS_API_KEY) {
    logger.warn(
      "No HELIUS_API_KEY and SYNTHETIC_FEED=false — pool detection will produce no events. " +
        "Set SYNTHETIC_FEED=true to test the pipeline locally, or add a Helius API key.",
    );
  }

  // === Socket.io broadcaster ===
  const socketServer = new SocketServer(detector);
  await socketServer.start();

  logger.info(
    {
      heliusActive: stream.isReady(),
      syntheticActive: !!synthetic,
      socketPort: env.ENGINE_HTTP_PORT,
    },
    "Phase 1 pipeline live",
  );

  // === Periodic stats ===
  const statsTimer = setInterval(() => {
    const stats = detector.getStats();
    logger.info(stats, "detector stats");
  }, 30_000);

  // === Graceful shutdown ===
  await new Promise<void>((resolve) => {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutdown signal received");
      clearInterval(statsTimer);
      synthetic?.stop();
      await socketServer.stop();
      await stream.stop();
      await disconnectPrisma();
      await closeRedis();
      resolve();
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  });

  logger.info("Goodbye.");
}

main().catch((err) => {
  logger.fatal({ err }, "Engine crashed during boot");
  process.exit(1);
});

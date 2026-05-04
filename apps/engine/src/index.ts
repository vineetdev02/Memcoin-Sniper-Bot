import { env, isPaperMode } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { closeRedis, pingRedis } from "./state/redis.js";
import { disconnectPrisma, getPrisma } from "./state/db.js";
import { HeliusLogStream } from "./feeds/helius-ws.js";
import { PoolDetector } from "./feeds/pool-detector.js";
import { SyntheticFeed } from "./feeds/synthetic-feed.js";
import { SocketServer } from "./api/socket-server.js";
import { FilterOrchestrator } from "./filters/orchestrator.js";
import { publishVerdict } from "./state/verdict-stream.js";
import { PositionStore } from "./state/position-store.js";
import { PnlTracker } from "./analytics/pnl-tracker.js";
import { Trader } from "./execution/trader.js";
import { ExitEngine } from "./exits/exit-engine.js";

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
  const orchestrator = new FilterOrchestrator();

  // === Phase 3: paper trading ===
  const positionStore = new PositionStore();
  const pnl = new PnlTracker(positionStore);
  const trader = new Trader(positionStore, pnl);
  const exitEngine = new ExitEngine(positionStore, env.SYNTHETIC_FEED ? 30 : 1);

  detector.on("pool", (event) => {
    trader.cachePool(event);
    void orchestrator.evaluate(event);
  });

  orchestrator.on("verdict", (v) => {
    void publishVerdict(v);
    if (v.decision === "snipe") {
      const pool = trader.resolvePool(v);
      if (pool) trader.handleVerdict(v, pool);
      else logger.warn({ poolAddress: v.poolAddress }, "snipe verdict missing pool cache");
    }
  });

  await stream.start();

  let synthetic: SyntheticFeed | null = null;
  if (env.SYNTHETIC_FEED) {
    synthetic = new SyntheticFeed(detector, env.SYNTHETIC_FEED_MIN_MS, env.SYNTHETIC_FEED_MAX_MS);
    synthetic.start();
  } else if (!env.HELIUS_API_KEY) {
    logger.warn(
      "No HELIUS_API_KEY and SYNTHETIC_FEED=false — pool detection will produce no events.",
    );
  }

  exitEngine.start();
  pnl.start(60_000);

  const socketServer = new SocketServer(detector, orchestrator, positionStore, pnl);
  await socketServer.start();

  logger.info(
    {
      heliusActive: stream.isReady(),
      syntheticActive: !!synthetic,
      socketPort: env.ENGINE_HTTP_PORT,
      filterCount: orchestrator.getStats().filters,
      tpLadder: env.TP_LADDER,
      stopLossPct: env.STOP_LOSS_PCT,
      maxConcurrent: env.MAX_CONCURRENT_POSITIONS,
      positionSizePct: env.POSITION_SIZE_PCT,
    },
    "Phase 3 pipeline live (paper trading)",
  );

  const statsTimer = setInterval(() => {
    const ds = detector.getStats();
    const os = orchestrator.getStats();
    const ps = positionStore.getStats();
    const ts = trader.getStats();
    const es = exitEngine.getStats();
    const snap = pnl.buildSnapshot();
    logger.info(
      {
        pools: ds.parsed,
        snipes: os.snipes,
        rejects: os.rejects,
        open: ps.open,
        closed: ps.totalClosed,
        winRate: `${ps.winRatePct.toFixed(1)}%`,
        balance: `$${snap.balanceUsd.toFixed(0)}`,
        realized: `$${ps.realizedPnlUsd.toFixed(2)}`,
        unrealized: `$${ps.unrealizedPnlUsd.toFixed(2)}`,
        skipped: ts.skippedFull + ts.skippedRate + ts.skippedExposure,
        failedFills: ts.failedFills,
        partials: es.partialFills,
        fullCloses: es.fullCloses,
        rugs: es.rugBroadcasts,
      },
      "stats",
    );
  }, 30_000);

  await new Promise<void>((resolve) => {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutdown");
      clearInterval(statsTimer);
      synthetic?.stop();
      exitEngine.stop();
      pnl.stop();
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

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
import { BotSwitch } from "./execution/bot-switch.js";
import { MarketFeed } from "./execution/market-price.js";
import { isSyntheticPool } from "./execution/price-simulator.js";
import { restorePositions } from "./state/position-restore.js";
import { limitRpcRate, rpcUsage } from "./utils/rpc-meter.js";
import { ExitEngine } from "./exits/exit-engine.js";
import { RugWatcher } from "./exits/rug-watcher.js";
import { DrawdownCircuit } from "./risk/drawdown-circuit.js";
import { bootstrapPresets } from "./state/filter-presets.js";
import { createAlerter } from "./alerts/index.js";

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

  // Before any connection exists: every RPC request from here on is paced.
  limitRpcRate(env.RPC_MAX_RPS);

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

  // === Phase 4: filter presets / runtime config ===
  await bootstrapPresets();

  // === Pool detection pipeline ===
  const stream = new HeliusLogStream();
  const detector = new PoolDetector(stream);
  const orchestrator = new FilterOrchestrator();

  // === Phase 3: paper trading ===
  const positionStore = new PositionStore();
  const pnl = new PnlTracker(positionStore);
  const circuit = new DrawdownCircuit(positionStore, pnl);
  // Market prices (Jupiter, free) for every open position on a real pool.
  // Synthetic positions keep their simulated price and are not polled.
  const market = new MarketFeed(() =>
    positionStore
      .list()
      .filter((p) => !positionStore.get(p.id)?.profile)
      .map((p) => p.tokenMint),
  );
  const trader = new Trader(positionStore, pnl, circuit, market);
  const exitEngine = new ExitEngine(positionStore, env.SYNTHETIC_FEED ? 30 : 1, market);
  const rugWatcher = new RugWatcher(positionStore, exitEngine, market);
  const alerter = createAlerter({ store: positionStore, circuit, pnl });

  // What the last run left open carries on; what it closed stays in the totals.
  try {
    await restorePositions(positionStore, pnl);
  } catch (err) {
    logger.error({ err }, "could not restore positions from the last run — starting without them");
  }

  // Filters run EVAL_DELAY_SEC after a pool appears. At launch the honeypot
  // quote, the volume and the socials do not exist yet, so several filters
  // could only answer "unknown" and no strict preset could ever pass.
  // Synthetic pools carry their answers and are judged at once.
  detector.on("pool", (event) => {
    const judge = () => {
      trader.cachePool(event);
      void orchestrator.evaluate(event);
    };
    const delayMs = isSyntheticPool(event) ? 0 : env.EVAL_DELAY_SEC * 1000;
    if (delayMs === 0) judge();
    else setTimeout(judge, delayMs).unref();
  });

  orchestrator.on("verdict", (v) => {
    void publishVerdict(v);
    if (v.decision === "snipe") {
      const pool = trader.resolvePool(v);
      if (pool) void trader.handleVerdict(v, pool);
      else logger.warn({ poolAddress: v.poolAddress }, "snipe verdict missing pool cache");
    }
  });

  // Built here, started only by the switch below.
  let synthetic: SyntheticFeed | null = null;
  if (env.SYNTHETIC_FEED) {
    synthetic = new SyntheticFeed(detector, env.SYNTHETIC_FEED_MIN_MS, env.SYNTHETIC_FEED_MAX_MS);
  } else {
    const urlNeedsKey = env.HELIUS_RPC_URL.endsWith("=");
    if (urlNeedsKey && !env.HELIUS_API_KEY) {
      logger.warn(
        "RPC URL needs an api-key suffix but HELIUS_API_KEY is empty — pool detection will produce no events.",
      );
    }
  }

  // Before circuit.start(): the alerter must hear a close before the halt it triggers.
  alerter?.start();
  circuit.start();
  market.start();
  exitEngine.start();
  rugWatcher.start();
  pnl.start(60_000);

  // Nothing subscribes to the RPC provider until the dashboard turns this on.
  const bot = new BotSwitch({
    feed: {
      start: async () => {
        await stream.start();
        synthetic?.start();
      },
      stop: async () => {
        synthetic?.stop();
        await stream.stop();
      },
      isLive: () => stream.isReady() || (synthetic?.isRunning() ?? false),
    },
    detector,
    orchestrator,
    trader,
  });

  const socketServer = new SocketServer(detector, orchestrator, positionStore, pnl, circuit, bot);
  await socketServer.start();

  logger.info(
    {
      botOn: bot.isOn(),
      syntheticConfigured: !!synthetic,
      socketPort: env.ENGINE_HTTP_PORT,
      filterCount: orchestrator.getStats().filters,
      tpLadder: env.TP_LADDER,
      stopLossPct: env.STOP_LOSS_PCT,
      maxConcurrent: env.MAX_CONCURRENT_POSITIONS,
      positionSizePct: env.POSITION_SIZE_PCT,
    },
    "Phase 3 pipeline live (paper trading)",
  );
  logger.warn(
    "Bot is OFF — not connected to the RPC provider (no credits spent), no pools, no trades. Press Bot OFF → ON on the dashboard.",
  );

  const statsTimer = setInterval(() => {
    const ds = detector.getStats();
    const os = orchestrator.getStats();
    const ps = positionStore.getStats();
    const ts = trader.getStats();
    const es = exitEngine.getStats();
    const rs = rugWatcher.getStats();
    const cs = circuit.getStats();
    const snap = pnl.buildSnapshot();
    const as = alerter?.getStats();
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
        rugWatch: rs.tracked,
        rugDetected: rs.detections,
        halted: cs.halted,
        haltReason: cs.haltReason,
        dailyLossUsd: cs.dailyLossUsd.toFixed(2),
        consLosses: cs.consecutiveLosses,
        skippedHalted: ts.skippedHalted,
        bot: bot.isOn() ? "on" : "off",
        rpcRequests: rpcUsage().rpcRequests,
        alerts: as ? (as.disabled ? "disabled" : `${as.sent} sent, ${as.failed} failed, ${as.dropped} dropped`) : undefined,
      },
      "stats",
    );
  }, 30_000);

  await new Promise<void>((resolve) => {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutdown");
      setTimeout(() => {
        logger.error("shutdown did not finish in 15s; forcing exit");
        exit(1);
      }, 15_000).unref();
      clearInterval(statsTimer);
      await alerter?.stop(signal);
      synthetic?.stop();
      rugWatcher.stop();
      exitEngine.stop();
      market.stop();
      circuit.stop();
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

/** Exit once the logger has written everything — in dev it logs from a worker thread. */
function exit(code: number): void {
  setTimeout(() => process.exit(code), 1000).unref();
  logger.flush(() => process.exit(code));
}

main().then(
  // Exit explicitly: the Solana websocket client keeps reconnecting after its
  // listeners are removed and would hold a stopped engine open indefinitely.
  () => exit(0),
  (err) => {
    logger.fatal({ err }, "Engine crashed during boot");
    exit(1);
  },
);

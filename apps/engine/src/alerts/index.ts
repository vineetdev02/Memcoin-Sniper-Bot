import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "../state/db.js";
import type { PositionStore } from "../state/position-store.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";
import type { DrawdownCircuit } from "../risk/drawdown-circuit.js";
import { Alerter } from "./alerter.js";
import type { ClosedTrade } from "./daily-summary.js";
import { AlertQueue } from "./queue.js";
import { TelegramClient } from "./telegram.js";

const log = childLogger("alerts");

/**
 * Build the Telegram alerter from env, or return null when alerts are not
 * configured. Never throws and never blocks boot on Telegram being reachable.
 */
export function createAlerter(deps: {
  store: PositionStore;
  circuit: DrawdownCircuit;
  pnl: PnlTracker;
}): Alerter | null {
  const token = env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = env.TELEGRAM_CHAT_ID.trim();

  if (!token && !chatId) {
    log.info("Telegram alerts off — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable");
    return null;
  }
  if (!token || !chatId) {
    // Half-configured is almost always a typo; say so rather than stay silent.
    log.warn(
      { missing: token ? "TELEGRAM_CHAT_ID" : "TELEGRAM_BOT_TOKEN" },
      "Telegram alerts off — only one of the two settings is present",
    );
    return null;
  }

  const client = new TelegramClient({ token, chatId });
  const queue = new AlertQueue({ client, log });

  // Check the token in the background so a bad one is reported at boot, not
  // at the first trade — which could be hours later.
  void client.getMe().then((out) => {
    if (out.kind === "ok") {
      const username = (out.result as { username?: string } | undefined)?.username;
      log.info({ bot: username ? `@${username}` : undefined }, "Telegram alerts on");
    } else if (out.kind === "fatal") {
      queue.disable(out.reason);
    } else {
      // Network trouble at boot is not a reason to give up; each alert retries on its own.
      log.warn({ reason: "reason" in out ? out.reason : out.kind }, "could not verify the Telegram bot yet");
    }
  });

  return new Alerter({
    mode: env.MODE,
    flags: {
      newPosition: env.ALERT_ON_NEW_POSITION,
      exit: env.ALERT_ON_EXIT,
      drawdownHalt: env.ALERT_ON_DRAWDOWN_HALT,
      dailyPnl: env.ALERT_ON_DAILY_PNL,
      engineStatus: env.ALERT_ON_ENGINE_STATUS,
    },
    dailyHourUtc: env.ALERT_DAILY_PNL_HOUR_UTC,
    sink: queue,
    store: deps.store,
    circuit: deps.circuit,
    bankroll: () => deps.pnl.buildSnapshot(),
    loadClosed: loadClosedFromDb,
    log,
  });
}

async function loadClosedFromDb(fromTs: number, toTs: number): Promise<ClosedTrade[]> {
  const rows = await getPrisma().position.findMany({
    where: {
      mode: env.MODE,
      status: "closed",
      closedAt: { gte: new Date(fromTs), lt: new Date(toTs) },
    },
    select: {
      tokenMint: true,
      realizedPnlUsd: true,
      entrySizeUsd: true,
      closeReason: true,
      closedAt: true,
    },
    take: 20_000,
  });
  return rows.map((r) => ({
    mint: r.tokenMint,
    realizedPnlUsd: r.realizedPnlUsd,
    entrySizeUsd: r.entrySizeUsd,
    // Prisma stores "stop_loss"; everything else in the engine says "stop-loss".
    closeReason: r.closeReason ? r.closeReason.replace(/_/g, "-") : null,
    closedAt: r.closedAt?.getTime() ?? toTs,
  }));
}

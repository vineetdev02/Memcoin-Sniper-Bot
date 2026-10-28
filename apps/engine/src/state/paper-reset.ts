import { open } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STARTING_BALANCE_MAX_USD,
  STARTING_BALANCE_MIN_USD,
  type ResetResult,
} from "@sniperbot/shared";
import { env } from "../config/env.js";
import { saveStartingBalance, startingBalanceUsd } from "../config/trading-settings.js";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "./db.js";
import { getRedis } from "./redis.js";
import { POOL_STREAM_KEY } from "./pool-stream.js";
import { VERDICT_STREAM_KEY } from "./verdict-stream.js";

const log = childLogger("paper-reset");

const BACKUP_DIR = fileURLToPath(new URL("../../backups/", import.meta.url));
const BATCH = 2_000;

/** The parts of the running engine that hold the paper account in memory. */
export interface ResetParts {
  bot: { isOn(): boolean };
  store: { reset(): void };
  pnl: { reset(startingBalanceUsd: number): void };
  circuit: { reset(): void };
  counters: Array<{ resetStats(): void }>;
  /** Stopped for the reset, so nothing writes a trade or a snapshot halfway through it. */
  timers: Array<{ start(): void; stop(): void }>;
}

type TableName = "pool" | "filterResult" | "poolDecision" | "position" | "trade" | "bankrollSnapshot";
const TABLES: TableName[] = ["pool", "filterResult", "poolDecision", "position", "trade", "bankrollSnapshot"];

/**
 * Starts the paper account over. "Safe" means, in order: refuse while the bot
 * is on or in live mode, write every row it is about to delete to a file,
 * delete in one transaction (so a failure deletes nothing), and only then
 * clear what the engine holds in memory. Filter presets, dashboard settings
 * and the rugged-dev list are kept.
 */
export class PaperAccount {
  private readonly parts: ResetParts;
  private running = false;

  constructor(parts: ResetParts) {
    this.parts = parts;
  }

  isResetting(): boolean {
    return this.running;
  }

  async reset(newStartingBalanceUsd: unknown): Promise<ResetResult> {
    if (env.MODE !== "paper") throw new Error("Reset is for paper trading only");
    if (this.parts.bot.isOn()) throw new Error("Turn the bot off first");
    if (
      typeof newStartingBalanceUsd !== "number" ||
      !Number.isFinite(newStartingBalanceUsd) ||
      newStartingBalanceUsd < STARTING_BALANCE_MIN_USD ||
      newStartingBalanceUsd > STARTING_BALANCE_MAX_USD
    ) {
      throw new Error(
        `Starting amount must be between $${STARTING_BALANCE_MIN_USD} and $${STARTING_BALANCE_MAX_USD.toLocaleString("en-US")}`,
      );
    }
    if (this.running) throw new Error("A reset is already running");

    this.running = true;
    for (const t of this.parts.timers) t.stop();
    try {
      const backupFile = await backupPaperData();
      const deleted = await deletePaperData();
      await getRedis().del(POOL_STREAM_KEY, VERDICT_STREAM_KEY);
      await saveStartingBalance(newStartingBalanceUsd);

      this.parts.store.reset();
      this.parts.pnl.reset(newStartingBalanceUsd);
      this.parts.circuit.reset();
      for (const c of this.parts.counters) c.resetStats();

      log.warn({ backupFile, deleted, startingBalanceUsd: newStartingBalanceUsd }, "paper account reset");
      return { backupFile, deleted, startingBalanceUsd: newStartingBalanceUsd };
    } finally {
      for (const t of this.parts.timers) t.start();
      this.running = false;
    }
  }
}

/** One JSON object per line: a header, then `{ table, row }` for every row the reset deletes. */
async function backupPaperData(): Promise<string> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `${BACKUP_DIR}paper-reset-${stamp}.ndjson`;
  const prisma = getPrisma();
  // "wx": never overwrite an earlier backup
  const handle = await open(file, "wx");
  try {
    await handle.write(
      JSON.stringify({
        kind: "sniperbot-paper-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        startingBalanceUsd: startingBalanceUsd(),
      }) + "\n",
    );
    for (const table of TABLES) {
      // every table here has a cuid `id`, so it pages the same way
      const delegate = prisma[table] as unknown as {
        findMany(args: { take: number; skip?: number; cursor?: { id: string }; orderBy: { id: "asc" } }): Promise<Array<{ id: string }>>;
      };
      let cursor: string | undefined;
      for (;;) {
        const rows = await delegate.findMany({
          take: BATCH,
          orderBy: { id: "asc" },
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (rows.length === 0) break;
        await handle.write(rows.map((row) => JSON.stringify({ table, row })).join("\n") + "\n");
        cursor = rows[rows.length - 1]!.id;
        if (rows.length < BATCH) break;
      }
    }
  } finally {
    await handle.close();
  }
  return file;
}

async function deletePaperData(): Promise<Record<string, number>> {
  const prisma = getPrisma();
  // Children first. Pools a live position still points at are kept, with their results.
  const [trades, positions, filterResults, poolDecisions, bankrollSnapshots, pools] = await prisma.$transaction([
    prisma.trade.deleteMany({ where: { position: { mode: "paper" } } }),
    prisma.position.deleteMany({ where: { mode: "paper" } }),
    prisma.filterResult.deleteMany({ where: { pool: { positions: { none: {} } } } }),
    prisma.poolDecision.deleteMany({}),
    prisma.bankrollSnapshot.deleteMany({ where: { mode: "paper" } }),
    prisma.pool.deleteMany({ where: { positions: { none: {} } } }),
  ]);
  return {
    trades: trades.count,
    positions: positions.count,
    filterResults: filterResults.count,
    poolDecisions: poolDecisions.count,
    bankrollSnapshots: bankrollSnapshots.count,
    pools: pools.count,
  };
}

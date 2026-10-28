import {
  formatTpLadder,
  parseTpLadder,
  validateSettingsPatch,
  type SettingsSnapshot,
  type TpRung,
  type TradingSettings,
} from "@sniperbot/shared";
import { env } from "./env.js";
import { getPrisma } from "../state/db.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("settings");

const TRADING_KEY = "trading";
const STARTING_BALANCE_KEY = "paperStartingBalanceUsd";

const defaults: TradingSettings = {
  positionSizePct: env.POSITION_SIZE_PCT,
  maxConcurrentPositions: env.MAX_CONCURRENT_POSITIONS,
  maxTotalExposurePct: env.MAX_TOTAL_EXPOSURE_PCT,
  maxPositionPerMin: env.MAX_POSITION_PER_MIN,
  stopLossPct: env.STOP_LOSS_PCT,
  tpLadder: formatTpLadder(env.TP_LADDER),
  trailingStopPct: env.TRAILING_STOP_PCT,
  trailingStopActivationPct: env.TRAILING_STOP_ACTIVATION_PCT,
  timeExitMin: env.TIME_EXIT_MIN,
  dailyDrawdownLimitPct: env.DAILY_DRAWDOWN_LIMIT_PCT,
  weeklyDrawdownLimitPct: env.WEEKLY_DRAWDOWN_LIMIT_PCT,
  haltOnConsecutiveLosses: env.HALT_ON_CONSECUTIVE_LOSSES,
  evalDelaySec: env.EVAL_DELAY_SEC,
};

let overrides: Partial<TradingSettings> = {};
let current: TradingSettings = { ...defaults };
let ladder: TpRung[] = env.TP_LADDER;
let startingBalance = env.PAPER_STARTING_BALANCE_USD;

/**
 * Only the values that differ from .env are kept, so a setting nobody touched
 * in the dashboard still follows .env when .env changes.
 */
export function mergeOverrides(
  base: TradingSettings,
  existing: Partial<TradingSettings>,
  patch: Partial<TradingSettings>,
): Partial<TradingSettings> {
  const merged: Partial<TradingSettings> = { ...existing, ...patch };
  for (const key of Object.keys(merged) as Array<keyof TradingSettings>) {
    if (merged[key] === base[key]) delete merged[key];
  }
  return merged;
}

function apply(next: Partial<TradingSettings>): void {
  overrides = next;
  current = { ...defaults, ...overrides };
  ladder = parseTpLadder(current.tpLadder) ?? env.TP_LADDER;
}

/** The settings in force now. Read at the moment of use, so a change reaches the next trade. */
export function tradingSettings(): Readonly<TradingSettings> {
  return current;
}

export function tpLadder(): TpRung[] {
  return ladder;
}

export function startingBalanceUsd(): number {
  return startingBalance;
}

export function settingsSnapshot(): SettingsSnapshot {
  return { settings: { ...current }, defaults: { ...defaults }, startingBalanceUsd: startingBalance };
}

/** What the dashboard saved last time. A stored value that no longer validates is dropped, not trusted. */
export async function loadSettings(): Promise<void> {
  let rows: Array<{ key: string; value: unknown }>;
  try {
    rows = await getPrisma().appSetting.findMany({
      where: { key: { in: [TRADING_KEY, STARTING_BALANCE_KEY] } },
    });
  } catch (err) {
    // a database from before this table existed: run on .env until it is migrated
    log.warn({ err: (err as Error).message }, "could not read dashboard settings — using .env. Run `pnpm prisma:migrate`.");
    return;
  }
  for (const row of rows) {
    if (row.key === TRADING_KEY) {
      const checked = validateSettingsPatch(row.value);
      if (checked.ok) apply(mergeOverrides(defaults, {}, checked.value));
      else log.warn({ error: checked.error }, "saved trading settings are invalid — using .env");
    } else if (row.key === STARTING_BALANCE_KEY && typeof row.value === "number" && row.value > 0) {
      startingBalance = row.value;
    }
  }
  if (rows.length > 0) log.info({ overrides, startingBalanceUsd: startingBalance }, "dashboard settings loaded");
}

export async function saveTradingSettings(patch: unknown): Promise<SettingsSnapshot> {
  const checked = validateSettingsPatch(patch);
  if (!checked.ok) throw new Error(checked.error);
  const next = mergeOverrides(defaults, overrides, checked.value);
  await getPrisma().appSetting.upsert({
    where: { key: TRADING_KEY },
    create: { key: TRADING_KEY, value: next },
    update: { value: next },
  });
  apply(next);
  log.info({ overrides: next }, "trading settings saved");
  return settingsSnapshot();
}

export async function saveStartingBalance(usd: number): Promise<void> {
  await getPrisma().appSetting.upsert({
    where: { key: STARTING_BALANCE_KEY },
    create: { key: STARTING_BALANCE_KEY, value: usd },
    update: { value: usd },
  });
  startingBalance = usd;
}

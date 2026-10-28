/**
 * Trading settings the dashboard can change while the engine runs. Each one
 * starts from its .env value; a value saved from the dashboard overrides it
 * and survives restarts.
 */
export interface TradingSettings {
  positionSizePct: number;
  maxConcurrentPositions: number;
  maxTotalExposurePct: number;
  maxPositionPerMin: number;
  /** Negative: -40 sells at a 40% loss. */
  stopLossPct: number;
  /** "gain%:sell%" steps, as in .env: "50:25,100:25,300:25,900:15". */
  tpLadder: string;
  trailingStopPct: number;
  trailingStopActivationPct: number;
  timeExitMin: number;
  dailyDrawdownLimitPct: number;
  weeklyDrawdownLimitPct: number;
  haltOnConsecutiveLosses: number;
  evalDelaySec: number;
}

export type NumericSettingKey = Exclude<keyof TradingSettings, "tpLadder">;

export interface SettingField {
  key: NumericSettingKey;
  group: "Position sizing" | "Exits" | "Risk" | "Filters";
  label: string;
  help: string;
  /** The .env name it overrides. */
  envName: string;
  min: number;
  max: number;
  integer?: boolean;
  unit?: string;
}

export const SETTING_FIELDS: ReadonlyArray<SettingField> = [
  { key: "positionSizePct", group: "Position sizing", label: "Size per trade", help: "% of the current bankroll each buy uses", envName: "POSITION_SIZE_PCT", min: 0.1, max: 100, unit: "%" },
  { key: "maxConcurrentPositions", group: "Position sizing", label: "Max open positions", help: "new snipes are skipped while this many are open", envName: "MAX_CONCURRENT_POSITIONS", min: 1, max: 100, integer: true },
  { key: "maxTotalExposurePct", group: "Position sizing", label: "Max total exposure", help: "% of the bankroll that may sit in open positions at once", envName: "MAX_TOTAL_EXPOSURE_PCT", min: 1, max: 100, unit: "%" },
  { key: "maxPositionPerMin", group: "Position sizing", label: "Max buys per minute", help: "a burst of snipes past this is skipped", envName: "MAX_POSITION_PER_MIN", min: 1, max: 60, integer: true },
  { key: "stopLossPct", group: "Exits", label: "Stop-loss", help: "sell everything at this loss; negative", envName: "STOP_LOSS_PCT", min: -99, max: -1, unit: "%" },
  { key: "trailingStopPct", group: "Exits", label: "Trailing stop", help: "once armed, sell when the price falls this far from its peak", envName: "TRAILING_STOP_PCT", min: 1, max: 99, unit: "%" },
  { key: "trailingStopActivationPct", group: "Exits", label: "Trailing stop arms at", help: "gain at which the trailing stop starts following the peak", envName: "TRAILING_STOP_ACTIVATION_PCT", min: 0, max: 10_000, unit: "%" },
  { key: "timeExitMin", group: "Exits", label: "Time exit", help: "sell whatever is left after this long", envName: "TIME_EXIT_MIN", min: 1, max: 10_080, integer: true, unit: "min" },
  { key: "dailyDrawdownLimitPct", group: "Risk", label: "Daily loss limit", help: "halt new trades after losing this % in 24 hours", envName: "DAILY_DRAWDOWN_LIMIT_PCT", min: 1, max: 100, unit: "%" },
  { key: "weeklyDrawdownLimitPct", group: "Risk", label: "Weekly loss limit", help: "halt new trades after losing this % in 7 days", envName: "WEEKLY_DRAWDOWN_LIMIT_PCT", min: 1, max: 100, unit: "%" },
  { key: "haltOnConsecutiveLosses", group: "Risk", label: "Halt after losses in a row", help: "halt new trades after this many losing trades in a row", envName: "HALT_ON_CONSECUTIVE_LOSSES", min: 1, max: 1_000, integer: true },
  { key: "evalDelaySec", group: "Filters", label: "Wait before judging", help: "seconds between a pool appearing and its filters running", envName: "EVAL_DELAY_SEC", min: 0, max: 3_600, integer: true, unit: "s" },
];

/** A fresh paper bankroll can be anything in this range. */
export const STARTING_BALANCE_MIN_USD = 10;
export const STARTING_BALANCE_MAX_USD = 10_000_000;

export interface TpRung {
  gainPct: number;
  sellPct: number;
}

/** "50:25,100:25" into rungs, or null when it is not that shape or sells more than 100%. */
export function parseTpLadder(text: string): TpRung[] | null {
  const compact = text.replace(/\s+/g, "");
  if (!/^(\d+(\.\d+)?:\d+(\.\d+)?)(,\d+(\.\d+)?:\d+(\.\d+)?)*$/.test(compact)) return null;
  const rungs = compact.split(",").map((entry) => {
    const [gain, sell] = entry.split(":");
    return { gainPct: Number(gain), sellPct: Number(sell) };
  });
  const sold = rungs.reduce((s, r) => s + r.sellPct, 0);
  if (sold > 100 || rungs.some((r) => r.gainPct <= 0 || r.sellPct <= 0)) return null;
  return rungs;
}

export function formatTpLadder(rungs: ReadonlyArray<TpRung>): string {
  return rungs.map((r) => `${r.gainPct}:${r.sellPct}`).join(",");
}

/** Checks a partial update from the dashboard. Unknown keys are refused, so a typo cannot pass silently. */
export function validateSettingsPatch(
  patch: unknown,
): { ok: true; value: Partial<TradingSettings> } | { ok: false; error: string } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return { ok: false, error: "expected an object of settings" };
  }
  const value: Partial<TradingSettings> = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (key === "tpLadder") {
      if (typeof raw !== "string" || !parseTpLadder(raw)) {
        return { ok: false, error: "Take-profit ladder must look like 50:25,100:25 and sell at most 100% in total" };
      }
      value.tpLadder = raw.replace(/\s+/g, "");
      continue;
    }
    const field = SETTING_FIELDS.find((f) => f.key === key);
    if (!field) return { ok: false, error: `unknown setting: ${key}` };
    if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, error: `${field.label} must be a number` };
    if (field.integer && !Number.isInteger(raw)) return { ok: false, error: `${field.label} must be a whole number` };
    if (raw < field.min || raw > field.max) {
      return { ok: false, error: `${field.label} must be between ${field.min} and ${field.max}` };
    }
    value[field.key] = raw;
  }
  return { ok: true, value };
}

export interface SettingsSnapshot {
  settings: TradingSettings;
  /** The .env values, for showing what changed and resetting one. */
  defaults: TradingSettings;
  startingBalanceUsd: number;
}

export interface ResetResult {
  backupFile: string;
  deleted: Record<string, number>;
  startingBalanceUsd: number;
}

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FilterId, ShadowFilterRow, ShadowReport } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";

const log = childLogger("shadow-report");

/** A launch "pumped" when its price went this far above the verdict's within the horizon. */
export const PUMP_PCT = 50;
const HORIZON_SEC = 15 * 60;
export const WINDOW_MS = 24 * 60 * 60_000;
const CACHE_MS = 60_000;

export interface ShadowLine {
  mint?: string;
  detectedAt?: number;
  verdictAt: number | null;
  decision: string | null;
  end: string;
  followedSec?: number;
  filters?: Record<string, [string, unknown]>;
  samples: [number, number, number][];
}

/** How far a launch's price rose within the horizon after its verdict, or null when it cannot be told. */
export function peakAfterVerdictPct(line: ShadowLine): number | null {
  if (!line.verdictAt || line.samples.length === 0) return null;
  // lines from before tracking began at detection count their seconds from the verdict
  const tv = line.detectedAt !== undefined ? (line.verdictAt - line.detectedAt) / 1000 : 0;
  let entry: [number, number, number] | undefined;
  for (const s of line.samples) if (s[0] <= tv) entry = s;
  // first reading of the curve a few seconds after the verdict still prices the entry
  if (!entry && line.samples[0]![0] <= tv + 5) entry = line.samples[0];
  if (!entry || entry[2] <= 0) return null;
  let peak = entry[2];
  for (const s of line.samples) if (s[0] > tv && s[0] <= tv + HORIZON_SEC) peak = Math.max(peak, s[2]);
  return (peak / entry[2] - 1) * 100;
}

/** Per filter: of the launches it failed and passed, how many went on to pump. */
export function buildShadowReport(lines: ShadowLine[], fromTs: number, toTs: number): ShadowReport {
  const rows = new Map<string, ShadowFilterRow>();
  let launches = 0;
  let pumped = 0;
  let snipes = 0;
  let snipesPumped = 0;
  for (const line of lines) {
    // a line cut short by a restart never saw its whole horizon
    if (line.end === "cut" || !line.verdictAt || line.verdictAt < fromTs) continue;
    const peak = peakAfterVerdictPct(line);
    if (peak === null) continue;
    const up = peak >= PUMP_PCT;
    launches++;
    if (up) pumped++;
    if (line.decision === "snipe") {
      snipes++;
      if (up) snipesPumped++;
    }
    for (const [id, [status]] of Object.entries(line.filters ?? {})) {
      const row = rows.get(id) ?? { filterId: id as FilterId, failed: 0, failedPumped: 0, passed: 0, passedPumped: 0 };
      if (status === "fail") {
        row.failed++;
        if (up) row.failedPumped++;
      } else if (status === "pass") {
        row.passed++;
        if (up) row.passedPumped++;
      }
      rows.set(id, row);
    }
  }
  return {
    launches,
    pumped,
    pumpThresholdPct: PUMP_PCT,
    horizonMin: HORIZON_SEC / 60,
    snipes,
    snipesPumped,
    fromTs,
    toTs,
    filters: [...rows.values()].sort((a, b) => b.failed - a.failed),
  };
}

let parsed: { dir: string; oldestDay: string; at: number; lines: ShadowLine[] } | null = null;

/**
 * Every line written since `fromTs`'s day, oldest file first. A day of files
 * is tens of megabytes and parsing blocks the engine's loop, so the report and
 * the strategy check share one parse a minute.
 */
export async function readShadowLines(dir: string, fromTs: number, now = Date.now()): Promise<ShadowLine[]> {
  const oldestDay = new Date(fromTs).toISOString().slice(0, 10);
  if (parsed && parsed.dir === dir && parsed.oldestDay === oldestDay && now - parsed.at < CACHE_MS) return parsed.lines;
  const lines: ShadowLine[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".ndjson") && f.slice(0, 10) >= oldestDay).sort();
  } catch {
    // nothing tracked yet
  }
  for (const f of files) {
    const text = await readFile(join(dir, f), "utf8");
    for (const raw of text.split("\n")) {
      if (!raw) continue;
      try {
        lines.push(JSON.parse(raw) as ShadowLine);
      } catch {
        // a line half-written at the moment of reading
      }
    }
  }
  parsed = { dir, oldestDay, at: now, lines };
  return lines;
}

let cached: { at: number; report: ShadowReport } | null = null;

/** The last 24 hours of shadow-tracked launches, re-read at most once a minute. */
export async function loadShadowReport(dir: string, now = Date.now()): Promise<ShadowReport> {
  if (cached && now - cached.at < CACHE_MS) return cached.report;
  const fromTs = now - WINDOW_MS;
  const lines = await readShadowLines(dir, fromTs, now);
  const report = buildShadowReport(lines, fromTs, now);
  cached = { at: now, report };
  log.debug({ lines: lines.length, launches: report.launches }, "shadow report built");
  return report;
}

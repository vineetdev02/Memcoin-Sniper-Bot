import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildShadowReport, loadShadowReport, peakAfterVerdictPct } from "./shadow-report.js";

const line = (o: Record<string, unknown>) => ({
  detectedAt: 0,
  verdictAt: 90_000,
  decision: "reject",
  end: "window",
  filters: {},
  samples: [] as [number, number, number][],
  ...o,
});

describe("shadow report", () => {
  test("measures the peak from the curve state at the verdict, within 15 minutes", () => {
    // 1.0 at the verdict, 1.8 at 5 min, 4.0 only after the horizon
    const l = line({ samples: [[3, 1, 1.0], [300 + 90, 5, 1.8], [90 + 901, 30, 4.0]] });
    assert.equal(Math.round(peakAfterVerdictPct(l)!), 80);
  });

  test("a launch that was already up before the verdict is measured from the verdict", () => {
    const l = line({ samples: [[10, 8, 3.0], [60, 1, 1.0], [200, 1.5, 1.2]] });
    assert.equal(Math.round(peakAfterVerdictPct(l)!), 20);
  });

  test("first-night lines count seconds from the verdict", () => {
    const l = { verdictAt: 90_000, decision: "reject", end: "window", samples: [[2, 1, 1.0], [100, 9, 2.0]] as [number, number, number][] };
    assert.equal(Math.round(peakAfterVerdictPct(l)!), 100);
  });

  test("per filter, counts what it failed and passed and how many of each pumped", () => {
    const up = [[1, 1, 1.0], [200, 9, 2.0]] as [number, number, number][];
    const flat = [[1, 0, 1.0]] as [number, number, number][];
    const r = buildShadowReport(
      [
        line({ samples: up, decision: "snipe", filters: { "curve-demand": ["pass", null] } }),
        line({ samples: up, filters: { "curve-demand": ["fail", null] } }),
        line({ samples: flat, filters: { "curve-demand": ["fail", null] } }),
        line({ samples: flat, filters: { "curve-demand": ["skip", null] } }),
        // cut short by a restart: never saw its whole horizon
        line({ samples: up, end: "cut", filters: { "curve-demand": ["fail", null] } }),
        // never judged
        line({ samples: up, verdictAt: null }),
      ],
      0,
      1e12,
    );
    assert.equal(r.launches, 4);
    assert.equal(r.pumped, 2);
    assert.equal(r.snipes, 1);
    assert.equal(r.snipesPumped, 1);
    assert.deepEqual(r.filters, [{ filterId: "curve-demand", failed: 2, failedPumped: 1, passed: 1, passedPumped: 1 }]);
  });

  test("reads the day files, skipping a half-written line and launches older than a day", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-report-"));
    const now = Date.parse("2026-10-29T03:00:00Z");
    const fresh = JSON.stringify(line({ verdictAt: now - 3_600_000, detectedAt: now - 3_690_000, samples: [[1, 1, 1.0]] }));
    const old = JSON.stringify(line({ verdictAt: now - 30 * 3_600_000, detectedAt: now - 30 * 3_600_000 - 90_000, samples: [[1, 1, 1.0]] }));
    await writeFile(join(dir, "2026-10-28.ndjson"), `${old}\n${fresh}\n{"mint":`);
    const r = await loadShadowReport(dir, now);
    assert.equal(r.launches, 1);
  });
});

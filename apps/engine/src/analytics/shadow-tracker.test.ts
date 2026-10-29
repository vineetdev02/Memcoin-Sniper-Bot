import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrchestratorVerdict, PoolEvent } from "@sniperbot/shared";
import { ShadowTracker, readCurve } from "./shadow-tracker.js";

const MINT = "So11111111111111111111111111111111111111112";

/** A pump.fun BondingCurve account `solIn` SOL into the curve. */
function curve(solIn: number, complete = false): { data: Buffer } {
  const data = Buffer.alloc(49);
  const vSol = 30e9 + solIn * 1e9;
  data.writeBigUInt64LE(BigInt(Math.round(30e9 * 1.073e15 / vSol)), 8);
  data.writeBigUInt64LE(BigInt(Math.round(vSol)), 16);
  data.writeBigUInt64LE(BigInt(Math.round(solIn * 1e9)), 32);
  data[48] = complete ? 1 : 0;
  return { data };
}

const verdict = (source = "pumpfun"): OrchestratorVerdict =>
  ({
    poolAddress: MINT,
    source,
    decision: "reject",
    totalScore: 83,
    decisionReason: "curve-demand: only 0.00 SOL",
    decidedAt: 90_000,
    results: [{ filterId: "curve-demand", status: "fail", score: 0, reason: "", metadata: { solIn: 0 }, evaluatedAt: 0, durationMs: 1 }],
  }) as unknown as OrchestratorVerdict;

const launch = (source: PoolEvent["source"] = "pumpfun") =>
  ({ source, tokenMint: MINT, poolAddress: MINT, detectedAt: 0, creatorWallet: "dev", rawEvent: { devBuySol: 1.5 } }) as PoolEvent;

async function setup(states: Array<{ data: Buffer } | null>) {
  const dir = await mkdtemp(join(tmpdir(), "shadow-"));
  let clock = 0;
  let reads = 0;
  const conn = {
    getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => states[Math.min(reads, states.length - 1)] ?? null),
  };
  const tracker = new ShadowTracker(conn as never, dir, 3000, 60_000, () => clock);
  const tick = async (ms: number) => {
    clock += ms;
    await tracker.poll();
    reads++;
  };
  const lines = async () =>
    (await readFile(join(dir, "1970-01-01.ndjson"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { tracker, tick, lines };
}

describe("shadow tracker", () => {
  test("a verdict for a launch it never saw is ignored", async () => {
    const { tracker } = await setup([curve(1)]);
    tracker.judged(verdict());
    assert.equal(tracker.getStats().following, 0);
  });

  test("reads SOL in and the price off a curve account", () => {
    const s = readCurve(curve(8.18).data)!;
    assert.equal(Math.round(s.solIn * 100) / 100, 8.18);
    assert.ok(s.price > readCurve(curve(0).data)!.price);
    assert.equal(readCurve(Buffer.alloc(10)), null);
  });

  test("keeps a sample only when the curve moved, and writes the launch when its window ends", async () => {
    const { tracker, tick, lines } = await setup([curve(1), curve(1), curve(2.5), curve(2.5)]);
    tracker.follow(launch());
    await tick(3000);
    await tick(3000);
    tracker.judged(verdict());
    await tick(3000);
    assert.equal((await lines()).length, 0);
    await tick(60_000);
    const [line] = await lines();
    assert.equal(line.mint, MINT);
    assert.equal(line.end, "window");
    assert.equal(line.verdictAt, 90_000);
    assert.equal(line.creator, "dev");
    assert.deepEqual(line.launch, { devBuySol: 1.5 });
    assert.deepEqual(line.filters["curve-demand"], ["fail", { solIn: 0 }]);
    // seconds from detection, and only where the curve moved
    assert.deepEqual(line.samples.map((s: number[]) => [s[0], s[1]]), [[3, 1], [9, 2.5]]);
    assert.equal(tracker.getStats().following, 0);
  });

  test("the launch's trade tape is written with its path", async () => {
    const { tracker, tick, lines } = await setup([curve(1)]);
    tracker.follow(launch());
    tracker.tape(MINT, { wallets: 2, devBuySol: 1, trades: [[2, 1, 0.5, 1]] });
    tracker.tape("not-followed", { wallets: 1, trades: [] });
    await tick(61_000);
    assert.deepEqual((await lines())[0].tape, { wallets: 2, devBuySol: 1, trades: [[2, 1, 0.5, 1]] });
  });

  test("a curve that graduates ends the follow, and its emptied reserves are not recorded as a crash", async () => {
    // graduation zeroes the reserves and keeps only the flag
    const graduated = { data: Buffer.alloc(49) };
    graduated.data[48] = 1;
    const { tracker, tick, lines } = await setup([curve(60), curve(81), graduated]);
    tracker.follow(launch());
    await tick(3000);
    await tick(3000);
    assert.equal((await lines()).length, 0);
    await tick(3000);
    const [line] = await lines();
    assert.equal(line.end, "complete");
    assert.deepEqual(line.samples.map((s: number[]) => s[1]), [60, 81]);
  });

  test("only pump.fun launches are followed, and stopping writes what is open as cut", async () => {
    const { tracker, tick, lines } = await setup([curve(1)]);
    tracker.follow(launch("pumpswap"));
    assert.equal(tracker.getStats().following, 0);
    tracker.follow(launch());
    await tick(3000);
    await tracker.stop();
    const [line] = await lines();
    assert.equal(line.end, "cut");
    // never judged: the line says so rather than leaving the field out
    assert.equal(line.decision, null);
    assert.equal(line.samples.length, 1);
  });

  test("a poll still waiting on the RPC when the tracker stops writes nothing twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-"));
    let release: () => void = () => undefined;
    const conn = {
      getMultipleAccountsInfo: () =>
        new Promise<Array<{ data: Buffer }>>((resolve) => {
          release = () => resolve([curve(1)]);
        }),
    };
    const tracker = new ShadowTracker(conn as never, dir, 3000, 1, () => 5000);
    tracker.follow(launch());
    const polling = tracker.poll();
    await tracker.stop();
    release();
    await polling;
    const text = await readFile(join(dir, "1970-01-01.ndjson"), "utf8");
    assert.equal(text.trim().split("\n").length, 1);
    assert.equal(JSON.parse(text).end, "cut");
  });

  test("a restart resumes the launches it cut short, and only those still inside their window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-"));
    let clock = 0;
    let state = curve(1);
    const conn = { getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => state) };
    const first = new ShadowTracker(conn as never, dir, 3000, 60_000, () => clock);
    first.follow(launch());
    clock = 3000;
    await first.poll();
    first.judged(verdict());
    await first.stop();

    clock = 10_000;
    state = curve(4);
    const second = new ShadowTracker(conn as never, dir, 3000, 60_000, () => clock);
    assert.equal(await second.resume(), 1);
    await second.poll();
    clock = 61_000;
    await second.poll();
    const lines = (await readFile(join(dir, "1970-01-01.ndjson"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.end), ["cut", "window"]);
    // the first run's samples and verdict carry over
    assert.deepEqual(lines[1].samples.map((x: number[]) => [x[0], x[1]]), [[3, 1], [10, 4]]);
    assert.equal(lines[1].decision, "reject");
    assert.equal(lines[1].creator, "dev");

    // finished now, so a third run resumes nothing; nor does one whose window has passed
    assert.equal(await new ShadowTracker(conn as never, dir, 3000, 60_000, () => 20_000).resume(), 0);
    const late = await mkdtemp(join(tmpdir(), "shadow-"));
    const cutter = new ShadowTracker(conn as never, late, 3000, 60_000, () => 0);
    cutter.follow(launch());
    await cutter.stop();
    assert.equal(await new ShadowTracker(conn as never, late, 3000, 60_000, () => 60_000).resume(), 0);
  });

  test("a failed read loses that tick, not the launch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-"));
    const conn = { getMultipleAccountsInfo: async () => { throw new Error("429"); } };
    const tracker = new ShadowTracker(conn as never, dir, 3000, 60_000, () => 3000);
    tracker.follow(launch());
    await tracker.poll();
    assert.deepEqual(tracker.getStats(), { following: 1, written: 0, readErrors: 1 });
  });
});

/**
 * `pnpm fixtures:label` — label pools by what actually happened to them on
 * chain, and write the fixture sets the filter harness scores against.
 *
 *   pnpm fixtures:label                      the 50 newest pools in the DB older than 24h
 *   pnpm fixtures:label --limit 200
 *   pnpm fixtures:label --input pools.json   pools the engine never saw
 *   pnpm fixtures:label --dry-run            print the labels, write nothing
 *   pnpm fixtures:label --relabel            re-check pools this script labeled before
 *
 * --input takes a JSON array of { tokenMint, source, signature?, creatorWallet? }.
 * `signature` is the pool's creation transaction; for pump.fun it is found
 * automatically. Hand-written fixture entries (no `labelSource`) are never touched.
 *
 * Only a clear yes becomes a label. Everything else is printed with the reason
 * it stayed unlabeled, because one wrong fixture skews every precision number
 * computed against it.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { DexSource, PoolEvent } from "@sniperbot/shared";
import { getRpcConnection } from "../state/rpc.js";
import { getPrisma, disconnectPrisma } from "../state/db.js";
import { SOL_MINT, USDC_MINT, USDT_MINT } from "../feeds/parsers/common.js";
import { Chain } from "./chain.js";
import {
  GOOD_HORIZON_SEC,
  GOOD_RETAIN_FRAC,
  HONEYPOT_MIN_AGE_SEC,
  HONEYPOT_MIN_BUYERS,
  WITHDRAWAL_MIN_FRAC_OF_PEAK,
  decideLabel,
  findCollapse,
  findWithdrawal,
  measureSurvival,
  reservePoints,
  resolveVaults,
  sampleAt,
  sampleGrid,
  tallyTraders,
  type Check,
  type Label,
  type TxSummary,
} from "./outcome.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const FILES: Record<Label, string> = {
  rug: "known-rugs.json",
  good: "known-good.json",
  honeypot: "known-honeypots.json",
};
const LABEL_SOURCE = "outcome-v1";

// Read every transaction up to this many in the first 7 days; sample above it.
const SAMPLE_BUDGET = 160;
// Extra transactions to read looking for a single non-creator sell.
const HONEYPOT_SCAN_BUDGET = 300;
const CREATOR_PAGES = 10;
const CREATOR_TX_BUDGET = 100;

// A pool whose reserve never reached this is noise, not a fixture.
const QUOTES: Record<string, { unit: string; minPeak: number }> = {
  [SOL_MINT]: { unit: "SOL", minPeak: 1 },
  [USDC_MINT]: { unit: "USDC", minPeak: 150 },
  [USDT_MINT]: { unit: "USDT", minPeak: 150 },
};

const PRISMA_SOURCE: Record<string, DexSource> = {
  raydium_amm: "raydium-amm",
  raydium_clmm: "raydium-clmm",
  raydium_launchpad: "raydium-launchpad",
};

interface Args {
  limit: number;
  input?: string;
  rps: number;
  maxPages: number;
  relabel: boolean;
  dryRun: boolean;
}

interface FixtureEntry {
  mint: string;
  poolAddress: string;
  source: DexSource;
  createdAt: number;
  label: Label;
  notes: string;
  labelSource?: string;
  labeledAt?: string;
  evidence?: Record<string, unknown>;
  event?: PoolEvent;
  [extra: string]: unknown;
}

type Outcome =
  | { kind: "labeled"; label: Label; notes: string; evidence: Record<string, unknown>; event: PoolEvent }
  | { kind: "skipped"; reason: string };

const skip = (reason: string): Outcome => ({ kind: "skipped", reason });

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 50, rps: 8, maxPages: 50, relabel: false, dryRun: false };
  const num = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) usage(`${flag} needs a positive whole number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = num(a, argv[++i]);
    else if (a === "--rps") args.rps = num(a, argv[++i]);
    else if (a === "--max-pages") args.maxPages = num(a, argv[++i]);
    else if (a === "--input") args.input = argv[++i] ?? usage("--input needs a file");
    else if (a === "--relabel") args.relabel = true;
    else if (a === "--dry-run") args.dryRun = true;
    else usage(`unknown flag ${a}`);
  }
  return args;
}

function usage(msg: string): never {
  console.error(`✗ ${msg}`);
  console.error("  usage: pnpm fixtures:label [--limit N] [--input file.json] [--rps N] [--max-pages N] [--relabel] [--dry-run]");
  process.exit(2);
}

const keyOf = (source: string, mint: string) => `${source}:${mint}`;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(2));
const dur = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)}m` : sec < 86400 ? `${(sec / 3600).toFixed(1)}h` : `${(sec / 86400).toFixed(1)}d`);

// ---------------------------------------------------------------------------
// Fixture files
// ---------------------------------------------------------------------------

async function loadFixtures(): Promise<Record<Label, FixtureEntry[]>> {
  const out = { rug: [], good: [], honeypot: [] } as Record<Label, FixtureEntry[]>;
  for (const label of Object.keys(FILES) as Label[]) {
    try {
      out[label] = JSON.parse(await readFile(path.join(FIXTURE_DIR, FILES[label]), "utf8")) as FixtureEntry[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return out;
}

async function saveFixtures(sets: Record<Label, FixtureEntry[]>): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  for (const label of Object.keys(FILES) as Label[]) {
    const sorted = [...sets[label]].sort((a, b) => a.createdAt - b.createdAt);
    await writeFile(path.join(FIXTURE_DIR, FILES[label]), `${JSON.stringify(sorted, null, 2)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Which pools
// ---------------------------------------------------------------------------

// A real signature is base58; the synthetic feed writes 88 hex characters. Hex
// without a `0` is valid base58 too, so both tests are needed to drop those pools
// before they cost an RPC call.
const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const HEX_ONLY = /^[0-9a-f]+$/;

async function poolsFromDb(limit: number, exclude: Set<string>): Promise<PoolEvent[]> {
  const rows = await getPrisma().pool.findMany({
    where: { detectedAt: { lte: new Date(Date.now() - HONEYPOT_MIN_AGE_SEC * 1000) } },
    orderBy: { detectedAt: "desc" },
  });
  return rows
    .filter((r) => BASE58_SIG.test(r.signature) && !HEX_ONLY.test(r.signature))
    .map((r) => ({
      poolAddress: r.poolAddress,
      tokenMint: r.tokenMint,
      baseMint: r.baseMint,
      source: PRISMA_SOURCE[r.source] ?? (r.source as DexSource),
      initialLiquidityUsd: r.initialLiquidityUsd,
      initialPriceUsd: r.initialPriceUsd,
      creatorWallet: r.creatorWallet,
      detectedAt: r.detectedAt.getTime(),
      signature: r.signature,
    }))
    .filter((p) => !exclude.has(keyOf(p.source, p.tokenMint)))
    .slice(0, limit);
}

type PartialPool = Partial<PoolEvent> & { tokenMint: string; source: DexSource };

async function poolsFromFile(file: string): Promise<PartialPool[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) usage(`${file} must hold a JSON array`);
  return raw.map((p: Partial<PoolEvent>, i) => {
    if (!p.tokenMint || !p.source) usage(`${file}[${i}] needs tokenMint and source`);
    return p as PartialPool;
  });
}

/** Fill in what an --input entry left out, from its creation transaction. */
async function completeEvent(chain: Chain, p: PartialPool, maxPages: number): Promise<PoolEvent | string> {
  let signature = p.signature;
  if (!signature) {
    if (p.source !== "pumpfun") return "no creation signature — only pump.fun can be found without one";
    const hist = await chain.listSignatures(chain.bondingCurve(p.tokenMint), { maxPages });
    if (!hist.complete) return `over ${maxPages}k transactions — cannot page back to creation`;
    signature = hist.rows.find((r) => r.ok)?.signature;
    if (!signature) return "bonding curve has no history";
  }
  const creation = await chain.fetchTx(signature);
  if (!creation) return "creation tx not found";
  return {
    poolAddress: p.poolAddress ?? p.tokenMint,
    tokenMint: p.tokenMint,
    baseMint: p.baseMint ?? SOL_MINT,
    source: p.source,
    initialLiquidityUsd: p.initialLiquidityUsd ?? 0,
    initialPriceUsd: p.initialPriceUsd ?? 0,
    creatorWallet: p.creatorWallet ?? creation.feePayer,
    detectedAt: p.detectedAt ?? creation.blockTime * 1000,
    signature,
  };
}

// ---------------------------------------------------------------------------
// One pool
// ---------------------------------------------------------------------------

async function labelPool(chain: Chain, pool: PoolEvent, maxPages: number): Promise<Outcome> {
  const now = Date.now() / 1000;
  const creation = await chain.fetchTx(pool.signature);
  if (!creation) return skip("creation tx not found — a synthetic-feed pool, or pruned by this RPC");
  if (!creation.ok) return skip("creation tx failed");
  const t0 = creation.blockTime;
  const age = now - t0;
  if (age < HONEYPOT_MIN_AGE_SEC) return skip(`only ${dur(age)} old — needs 24h`);

  const quoteMint = pool.baseMint; // the engine's `baseMint` is the quote side of the pair
  const quote = QUOTES[quoteMint];
  if (!quote) return skip(`quoted in ${short(quoteMint)}, not SOL/USDC/USDT`);
  const creator = pool.creatorWallet;

  const bondingCurve = pool.source === "pumpfun" ? chain.bondingCurve(pool.tokenMint) : undefined;
  const vaults = resolveVaults(creation, { tokenMint: pool.tokenMint, quoteMint, creator, bondingCurve });
  if (typeof vaults === "string") return skip(vaults);

  if (bondingCurve) {
    const complete = await chain.curveComplete(bondingCurve);
    if (complete === null) return skip("bonding curve account is gone");
    // migration empties the curve, which would read as a 100% liquidity drop
    if (complete) return skip("graduated to PumpSwap — label its PumpSwap pool instead");
  }

  const listed = await chain.listSignatures(vaults.quote.account, { until: pool.signature, maxPages });
  if (!listed.complete) return skip(`over ${maxPages}k transactions — raise --max-pages to reach creation`);
  const lifetime = listed.rows.filter((r) => r.ok && r.t >= t0);
  const inHorizon = lifetime.filter((r) => r.t <= t0 + GOOD_HORIZON_SEC);
  const exact = inHorizon.length <= SAMPLE_BUDGET;
  const picked = exact ? inHorizon : sampleAt(inHorizon, t0, sampleGrid());
  const txs = [creation, ...(await chain.fetchTxs(picked.map((r) => r.signature)))].filter((t) => t.ok);

  const points = reservePoints(txs, vaults);
  const peak = Math.max(0, ...points.map((p) => p.reserve));
  if (peak < quote.minPeak) return skip(`reserve peaked at ${fmt(peak)} ${quote.unit} — too small to mean anything`);

  const evidence: Record<string, unknown> = {
    quoteUnit: quote.unit,
    quoteVault: vaults.quote.account,
    peakReserve: peak,
    txsInFirst7d: inHorizon.length,
    txsRead: txs.length,
    everyTxRead: exact,
  };
  const reasons: string[] = [];

  // --- rug -----------------------------------------------------------------
  let rug: Check = "no";
  const collapse = findCollapse(points, t0);
  if (collapse) {
    const dropPct = (1 - collapse.low / collapse.peak) * 100;
    evidence.collapse = { ...collapse, dropPct };
    const inDrop = (t: number) => t >= collapse.peakAt && t <= collapse.lowAt;
    const minAmount = collapse.peak * WITHDRAWAL_MIN_FRAC_OF_PEAK;
    let withdrawal = findWithdrawal(txs.filter((t) => inDrop(t.blockTime)), vaults, creator, quoteMint, minAmount);
    let checkedAll = exact;
    if (!withdrawal && !exact) {
      // Sampled: the drain can sit between two samples. The creator's own
      // transactions in the drop that also touched the pool are the only candidates.
      const mine = await chain.listSignatures(creator, { stopBefore: collapse.peakAt, maxPages: CREATOR_PAGES });
      const poolSigs = new Set(lifetime.filter((r) => inDrop(r.t)).map((r) => r.signature));
      const both = mine.rows.filter((r) => r.ok && inDrop(r.t) && poolSigs.has(r.signature));
      checkedAll = mine.complete && both.length <= CREATOR_TX_BUDGET;
      const extra = await chain.fetchTxs(both.slice(0, CREATOR_TX_BUDGET).map((r) => r.signature));
      withdrawal = findWithdrawal(extra, vaults, creator, quoteMint, minAmount);
    }
    if (withdrawal) {
      rug = "yes";
      evidence.creatorWithdrawal = withdrawal;
    } else {
      // Not a rug by the definition, but a 90% collapse is not a survivor either.
      rug = "unknown";
      reasons.push(
        checkedAll
          ? `liquidity fell ${dropPct.toFixed(0)}% but the creator took nothing out — a crowd dump, or a dev using another wallet`
          : `liquidity fell ${dropPct.toFixed(0)}%; could not read all of the creator's transactions in the drop`,
      );
    }
  }

  // --- honeypot --------------------------------------------------------------
  const traders = tallyTraders(txs, vaults, creator);
  let honeypot: Check = "no";
  if (traders.sellers.size === 0) {
    const seen = new Set(txs.map((t) => t.signature));
    const rest = lifetime.filter((r) => !seen.has(r.signature));
    let scanned = 0;
    while (scanned < rest.length && scanned < HONEYPOT_SCAN_BUDGET && traders.sellers.size === 0) {
      const chunk = rest.slice(scanned, Math.min(scanned + 50, HONEYPOT_SCAN_BUDGET));
      tallyTraders(await chain.fetchTxs(chunk.map((r) => r.signature)), vaults, creator, traders);
      scanned += chunk.length;
    }
    if (traders.sellers.size > 0) honeypot = "no";
    else if (scanned < rest.length) {
      honeypot = "unknown";
      reasons.push(`no outside seller in the first ${txs.length + scanned} of ${lifetime.length + 1} txs`);
    } else if (traders.buyers.size >= HONEYPOT_MIN_BUYERS) honeypot = "yes";
    else {
      honeypot = "unknown";
      reasons.push(`nobody sold, but only ${traders.buyers.size} outside buyer(s) — too few to call a honeypot`);
    }
  }
  evidence.outsideBuyers = traders.buyers.size;
  evidence.outsideSellers = traders.sellers.size;

  // --- good ----------------------------------------------------------------
  let good: Check = "no";
  if (age < GOOD_HORIZON_SEC) {
    good = "unknown";
    if (rug === "no" && honeypot === "no") reasons.push(`only ${dur(age)} old — survival needs 7d`);
  } else {
    const survival = measureSurvival(points, t0);
    if (survival) {
      evidence.survival = survival;
      good = survival.retainedPct >= GOOD_RETAIN_FRAC * 100 ? "yes" : "no";
      if (good === "no" && rug === "no") {
        reasons.push(`held ${survival.retainedPct.toFixed(0)}% of its peak at 7d — neither a rug nor a survivor`);
      }
    }
  }

  const label = decideLabel({ honeypot, rug, good });
  if (!label) return skip(reasons.join("; ") || "no rule matched");

  const sampled = exact ? "every tx read" : `peak from ${txs.length} samples of ${inHorizon.length} txs`;
  let notes: string;
  if (label === "rug" && collapse) {
    const w = evidence.creatorWithdrawal as { amount: number; signature: string };
    notes =
      `Liquidity fell ${((1 - collapse.low / collapse.peak) * 100).toFixed(0)}% ` +
      `(${fmt(collapse.peak)} → ${fmt(collapse.low)} ${quote.unit}) ${dur(collapse.lowAt - t0)} after creation; ` +
      `creator took ${fmt(w.amount)} ${quote.unit} out in ${short(w.signature)}`;
  } else if (label === "honeypot") {
    notes = `${traders.buyers.size} outside wallets bought, none ever sold (all ${lifetime.length + 1} txs read)`;
  } else {
    const s = evidence.survival as { retainedPct: number; atHorizon: number };
    notes = `Held ${s.retainedPct.toFixed(0)}% of its ${fmt(peak)} ${quote.unit} peak at 7 days (${sampled})`;
  }
  return { kind: "labeled", label, notes, evidence, event: pool };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sets = await loadFixtures();

  const existing = new Map<string, { label: Label; entry: FixtureEntry }>();
  for (const label of Object.keys(sets) as Label[]) {
    for (const entry of sets[label]) existing.set(keyOf(entry.source, entry.mint), { label, entry });
  }
  // Hand-written entries are never re-checked; this script's own are, with --relabel.
  const exclude = new Set(
    [...existing].filter(([, v]) => !args.relabel || v.entry.labelSource !== LABEL_SOURCE).map(([k]) => k),
  );

  const chain = new Chain(getRpcConnection(), args.rps);
  const pools: (PoolEvent | { partial: PartialPool })[] = args.input
    ? (await poolsFromFile(args.input))
        .filter((p) => !exclude.has(keyOf(p.source, p.tokenMint)))
        .map((partial) => ({ partial }))
    : await poolsFromDb(args.limit, exclude);

  if (pools.length === 0) {
    console.log("Nothing to label — no pools older than 24h that are not already in a fixture file.");
    await disconnectPrisma();
    return;
  }
  console.log(`Labeling ${pools.length} pool(s) from ${args.input ?? "the database"}…\n`);

  const counts: Record<Label | "skipped", number> = { rug: 0, good: 0, honeypot: 0, skipped: 0 };
  let changed = false;
  for (const item of pools) {
    const mint = "partial" in item ? item.partial.tokenMint : item.tokenMint;
    const source = "partial" in item ? item.partial.source : item.source;
    let outcome: Outcome;
    try {
      const event = "partial" in item ? await completeEvent(chain, item.partial, args.maxPages) : item;
      outcome = typeof event === "string" ? skip(event) : await labelPool(chain, event, args.maxPages);
    } catch (err) {
      outcome = skip(`error: ${(err as Error).message}`);
    }

    const tag = outcome.kind === "labeled" ? `✓ ${outcome.label.padEnd(8)}` : "· unlabeled";
    const text = outcome.kind === "labeled" ? outcome.notes : outcome.reason;
    console.log(`${tag}  ${short(mint)}  ${source.padEnd(17)} ${text}`);

    const key = keyOf(source, mint);
    const prior = existing.get(key);
    if (prior) {
      // only reachable with --relabel, and only for this script's own entries
      sets[prior.label] = sets[prior.label].filter((e) => e !== prior.entry);
      existing.delete(key);
      changed = true;
      if (outcome.kind === "skipped") console.log(`             dropped its earlier "${prior.label}" label`);
    }
    if (outcome.kind === "skipped") {
      counts.skipped++;
      continue;
    }
    counts[outcome.label]++;
    changed = true;
    const entry: FixtureEntry = {
      mint,
      poolAddress: outcome.event.poolAddress,
      source,
      createdAt: outcome.event.detectedAt,
      label: outcome.label,
      notes: outcome.notes,
      labelSource: LABEL_SOURCE,
      labeledAt: new Date().toISOString().slice(0, 10),
      evidence: outcome.evidence,
      event: outcome.event,
    };
    sets[outcome.label].push(entry);
    existing.set(key, { label: outcome.label, entry });
  }

  console.log(
    `\n${counts.rug} rug · ${counts.good} good · ${counts.honeypot} honeypot · ${counts.skipped} unlabeled` +
      `  (${chain.rpcCalls} RPC calls, ${chain.cacheHits} txs from cache)`,
  );
  const totals = (Object.keys(FILES) as Label[]).map((l) => `${FILES[l]}: ${sets[l].length}`).join(" · ");
  if (args.dryRun) {
    console.log(`--dry-run: nothing written. Would hold ${totals}`);
  } else if (changed) {
    await saveFixtures(sets);
    console.log(`Wrote ${path.relative(process.cwd(), FIXTURE_DIR) || "."}/ — ${totals}`);
  }
  await disconnectPrisma();
}

void main().catch(async (err) => {
  console.error(`✗ ${(err as Error).message}`);
  await disconnectPrisma();
  process.exit(3);
});

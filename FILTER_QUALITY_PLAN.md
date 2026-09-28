# Filter Quality Plan — From 6/10 to 9/10

> Goal: take the 12-filter engine from "implementations exist but several are best-effort heuristics" to "every filter has a documented evidence basis, measurable precision/recall, and a validation harness."
> Scope: paper trading only. No live wallet code touched.
> Authoring constraints: every improvement listed here must be measurable (false-positive rate, precision, recall, lift) — no "feels better" claims.

---

## 1. What "9/10" actually means (definition)

A filter scores 9/10 when **all of these hold**:

| Criterion | What it means |
|---|---|
| **Correctness** | Verified against a labeled fixture set (≥20 good + ≥20 rug mints) with documented precision/recall |
| **Evidence basis** | Uses on-chain or first-party data, not just one heuristic. Multi-source consensus where available. |
| **Explainability** | The `reason` field on every result is precise enough that a human can audit the call without re-running. Includes the numeric evidence (counts, percentages, addresses). |
| **Confidence score** | Filter returns a confidence 0–100, not just pass/fail. Orchestrator weights uncertain results lower. |
| **Edge cases documented** | Known failure modes have either a fix, a fallback, or a documented `skip` |
| **No silent skips in real mode** | If a filter can't reach a verdict, it logs why and the dashboard surfaces it |
| **Backtest-validated** | Replayed against real historical Solana pool data, not just synthetic |
| **Cached + budgeted** | All RPC calls cached. No filter consumes >5% of QuickNode daily quota under normal load. |

A 10/10 adds:
- **Tracked in production** — per-filter precision/recall in the analytics page, refreshed daily
- **Auto-tuning** — thresholds re-derived from rolling win-rate data

---

## 2. Current state audit — per filter

Honest assessment of each filter as it stands today. Scores reflect how close each is to 9/10.

| # | Filter | Score | What works | What's broken / weak |
|---|---|---|---|---|
| 1 | `liquidity-min` | 8/10 | Straight numeric threshold on detected liquidity. Hard to get wrong. | Trusts `pool.initialLiquidityUsd` from the parser — which itself is approximated from SOL deposits in the creation tx. For Raydium AMM with mid-tx liquidity adds, the number can be off by 20%+. No floor on liquidity *quality* (LP token holder distribution). |
| 2 | `lp-locked` | **2/10** | Has the framework + 2 known locker addresses + burn address constant. | **Currently SKIPPED in real mode.** Falls through to "real-mode LP detection deferred to IDL-aware decoding". Means today this filter does nothing on real pools. Critical gap. |
| 3 | `mint-authority` | 9/10 | Direct on-chain read via `getParsedAccountInfo`. Reliable. | Missing: detection of multisig mint authority (renouncing to a multisig is still a risk). |
| 4 | `freeze-authority` | 9/10 | Same pattern as mint-authority. Reliable. | Same multisig blind spot. |
| 5 | `top-holders` | **5/10** | Calls `getTokenLargestAccounts`, computes top-1% and top-10%. | **Major false-positive: doesn't exclude the LP pool token account, burn addresses, or locker contracts.** LP account is almost always the #1 holder with 50–80%, which would fail every pool. Either the filter is silently passing rugs (because top1 *includes* LP and looks normal) or rejecting good ones — need to verify which. |
| 6 | `dev-wallet` | 6/10 | RugCheck API + local `RuggedDevWallet` table + in-proc cache. Sound architecture. | Falls back to `pass (score 50)` for unknown wallets — permissive. RugCheck often unreachable (need fallback chain). No on-chain history fallback. No multi-hop funding source check (dev funded by known rugger = miss). |
| 7 | `bundled-launch` | 5/10 | Samples first 8 txs, checks fee-payer dominance ≥50%. New implementation. | Sybil pattern where each wallet has exactly 1 tx but ALL funded by same source slips through (dominance = 1/8 = 12.5%). Funding-graph clustering needed, not just per-tx counting. |
| 8 | `insider-detection` | 4/10 | Finds first inbound SOL transfer, checks funder against `RuggedDevWallet`. | One-hop only. Misses dev→shell→rugger chains. Empty insider DB right now. Needs a community insider list + multi-hop traversal. |
| 9 | `honeypot-sim` | 7/10 | Jupiter `/quote` simulation, fresh-pool grace window (just added). Price impact as tax proxy. | Not an actual sell-tx simulation — relies on Jupiter routing decisions which can be wrong on edge tokens. Real honeypot detection needs `simulateTransaction` with a signed (but unsubmitted) sell. No detection of transfer-fee tokens (Token2022). |
| 10 | `social-signal` | 6/10 | DexScreener websites + socials + boosts. Cached. | DexScreener-only; misses real social signal (Twitter followers/tweet velocity, Telegram member count). No domain age check (1-day-old throwaway sites). |
| 11 | `volume-velocity` | 7/10 | DexScreener m5 buys/sells + min-buys threshold + min-age guard. | Single time window. No trend (is buy/sell ratio improving or worsening?). No unique-buyer count. |
| 12 | `anti-sniper-war` | 6/10 | Counts signatures in first 6s window via `getSignaturesForAddress`. Cached. | Doesn't weight by priority fee (high-fee snipers are the dangerous ones). Doesn't distinguish buy txs from sell/other. |

**Aggregate today: ~6/10.** Biggest drags: `lp-locked` (no-op in real mode), `top-holders` (LP-account false positives), `insider-detection` (one-hop only), `bundled-launch` (no funding-graph clustering).

---

## 3. Architecture upgrades (cross-cutting, before per-filter work)

These improvements affect all filters and unlock the per-filter work.

### 3.1 Confidence scores, not just pass/fail

Today `FilterResult.score` exists but only as `pass=100 / fail=0`. Upgrade so every filter returns a 0–100 confidence, and the orchestrator weights uncertain results.

```ts
// Today
return makeResult("dev-wallet", "pass", "unknown wallet");

// After
return makeResult("dev-wallet", "pass", "unknown wallet (no history)", {
  score: 40,        // low confidence — unknown, not verified
  confidenceBasis: "no-data",
});
```

The orchestrator's `computeVerdict` already multiplies `score × weight`. Filters returning `score: 40` instead of `100` will pull the verdict down without hard-rejecting.

### 3.2 Exclusion registry (shared across holder-style filters)

Single source of truth for "addresses that shouldn't count toward concentration":
- LP pool token accounts (per DEX program)
- Burn addresses (`11111…` system, known dead addresses)
- Known locker program PDAs (Streamflow, Team Finance, PinkLock, Jupiter Lock)
- Vesting contract addresses
- Verified team multisigs

New module: `apps/engine/src/state/exclusion-registry.ts`. Loaded at boot, queryable by filters.

### 3.3 Provider fallback chain

Today each filter calls one API directly. Improve so each external lookup has a fallback ordered list:

```
dev-wallet:    RugCheck → Solsniffer → on-chain scan
holders:       Helius DAS → Birdeye → getTokenLargestAccounts
pair-info:     DexScreener → GeckoTerminal → Birdeye
social:        DexScreener → Twitter API → on-chain metadata URI fetch
```

New module: `apps/engine/src/feeds/provider-chain.ts`. Each provider has timeout, rate-limit-aware backoff, and circuit-breaker per provider.

### 3.4 Filter test harness

Replay any list of historical mints through all filters offline.

```bash
pnpm engine:filter-test --fixture fixtures/known-rugs.json
# → table per filter showing pass/fail/skip vs labeled truth
# → precision, recall, F1 per filter
# → confusion matrix
```

Fixture format:
```json
[
  { "mint": "ABCD…xyz", "label": "rug", "poolAddress": "…", "source": "pumpfun" },
  ...
]
```

### 3.5 Per-filter logging contract

Every `FilterResult.metadata` must include:
- `confidenceBasis: "on-chain" | "rugcheck" | "dexscreener" | "no-data" | "cached"`
- Numeric evidence (counts, percentages, addresses) needed to audit the call
- `dataAgeMs` if filter used cached data
- `providerLatencyMs` for any external call

Dashboard expansion already shows reason + ms; just needs the richer metadata to flow through.

### 3.6 Token2022 support audit

Several filters don't handle Token2022 mints (which support transfer fees, transfer hooks, mint extensions). Every on-chain read needs to check `program == TOKEN_2022_PROGRAM_ID` and use the matching parser.

---

## 4. Per-filter upgrades

Each filter has: **target score**, **fix list**, **specific tactic**, **validation**.

### Filter 1 — `liquidity-min` (8 → 9)

- **Fix**: Cross-validate detected liquidity against DexScreener `liquidity.usd` once pool is ≥30s old (skip otherwise). Reject if the two readings diverge by >50% (parser is wrong).
- **Fix**: Add LP-distribution check — at least 2 distinct LP holders (avoid single-wallet 100%-LP pools)
- **Validate**: Replay 40 fixtures, accept if false-fail rate <5%.

### Filter 2 — `lp-locked` (2 → 9) ⚠️ HIGHEST PRIORITY

- **Build**: Per-DEX LP-mint resolver. Decode Raydium AMM/CLMM/PumpSwap account layouts to extract the `lpMint`. For pump.fun pre-graduation: use `bondingCurve` check instead.
- **Build**: LP-holder concentration check — call `getTokenLargestAccounts(lpMint)`, sum the % held by known burn + locker addresses (from §3.2 exclusion registry).
- **Decision**:
  - `≥95% of LP burned or locked` → pass (score 100)
  - `≥50% locked` → pass (score 70)
  - `<50% locked AND >50% in dev wallet` → fail
  - pump.fun pre-graduation → skip with `reason: "bonding curve — no LP yet"`
- **Validate**: Manual test against 5 known burn-LP pools + 5 known dev-holds-LP pools.

### Filter 3 — `mint-authority` (9 → 10)

- **Fix**: If authority is set, check if it's a known multisig (Squads, Realms) → mark as `pass with score 70` instead of fail. Pure-rug devs use EOA, legit projects use multisigs.
- **Validate**: 10 fixtures with known multisig-mint, 10 with dev-EOA.

### Filter 4 — `freeze-authority` (9 → 10)

- Same multisig allowance as mint-authority.

### Filter 5 — `top-holders` (5 → 9) ⚠️ HIGH PRIORITY

- **Fix**: **Subtract excluded addresses** before computing top1% / top10%. Apply §3.2 exclusion registry. Top holders ≠ LP, burn, locker, vesting.
- **Fix**: Switch to **Helius DAS** API (`getTokenAccounts` with filtering) as primary source — paginated, more accurate than `getTokenLargestAccounts` (which returns max 20).
- **Build**: Cluster top holders by funding source — 5 wallets funded by same address count as 1 holder for concentration purposes.
- **Validate**: 20 fixtures, false-positive rate <10%.

### Filter 6 — `dev-wallet` (6 → 9)

- **Build**: 3-tier lookup with fallback chain (§3.3): RugCheck → Solsniffer → on-chain scan.
- **Build**: On-chain fallback — when both external APIs miss, scan dev's last 20 token deployments via Helius. Compute "rug rate" as: `tokens where current liquidity / peak liquidity < 0.1`.
- **Fix**: Tighten unknown-wallet default from `pass score 50` to `pass score 30` (less permissive). For dev-wallets with zero history, requires other filters to compensate.
- **Validate**: 30 fixtures including 10 known repeat ruggers — precision >90%.

### Filter 7 — `bundled-launch` (5 → 9)

- **Build**: Funding-graph clustering. For early buyers (first 20 txs), trace funder for each via §3.5 logic. Group wallets sharing a funder. Reject if any single funding cluster controls ≥40% of early buys.
- **Fix**: Use buy-volume share, not tx-count share (one tx for 5 SOL ≠ one tx for 0.01 SOL).
- **Validate**: 15 known bundled-launch pools + 15 organic pools.

### Filter 8 — `insider-detection` (4 → 9)

- **Build**: Multi-hop funding traversal (default 3 hops). Walk dev → funder → funder's funder. Flag if any wallet in chain is in known-rugger DB.
- **Build**: Seed `KnownInsiderWallet` table from community sources (Birdeye flagged, RugCheck flagged, manual entries). New Prisma model + import script.
- **Fix**: Default for "no funder found" → `skip with reason`, not `pass with score 50`.
- **Validate**: 20 fixtures including known insider-funded rugs — recall >80%.

### Filter 9 — `honeypot-sim` (7 → 9)

- **Build**: Real sell-tx simulation via `connection.simulateTransaction`. Construct a Jupiter swap tx (token → SOL) with a dummy signer, simulate, check logs for transfer failures or fee deductions >X%.
- **Build**: Token2022 transfer-fee extension check — read mint extensions, reject if `transferFee > maxSellTaxPct`.
- **Keep**: Fresh-pool grace window (already shipped).
- **Validate**: 10 known honeypots + 30 normal tokens. Honeypot recall >95%, false-positive <5%.

### Filter 10 — `social-signal` (6 → 9)

- **Build**: Twitter API integration — if creator/token Twitter handle in pool metadata, fetch followers + recent tweet count. Score 0–100 based on follower count + account age + tweet velocity.
- **Build**: Metadata-URI fetch — if DexScreener has no socials, fetch the token's metadata URI from on-chain (Metaplex) and parse `external_url`, `twitter`, `telegram` from there.
- **Build**: Domain-age check via WHOIS lookup (cached 30 days). Domain <7 days old → score penalty.
- **Validate**: 30 fixtures, lift over baseline win-rate should be >5pp.

### Filter 11 — `volume-velocity` (7 → 9)

- **Build**: Multi-window analysis (m5 + h1) — detect accelerating vs decelerating trend.
- **Build**: Unique-buyer count for the m5 window — proxies for organic interest vs single-wallet pumping.
- **Fix**: Skip → pass-low-confidence for pools with positive but small activity (instead of skip).
- **Validate**: 20 fixtures, win-rate lift on PASS vs FAIL.

### Filter 12 — `anti-sniper-war` (6 → 9)

- **Build**: Weight by priority fee — sum the priority fees paid in first 6s. High aggregate = serious sniper bots, more dangerous.
- **Build**: Distinguish buy vs other tx by checking instructions (Raydium/PumpSwap swap with token as output).
- **Validate**: Compare paper trades that passed vs failed this filter, track win-rate lift.

---

## 5. Test fixtures & validation framework

### 5.1 Fixture sets (curated by you, one-time effort)

Three labeled sets, stored as JSON in `apps/engine/fixtures/`:

| File | Size | Source |
|---|---|---|
| `known-rugs.json` | 30 mints | Pull from RugCheck's "rugged" list + manual additions |
| `known-good.json` | 30 mints | Verified survivors — tokens >7d old with liquidity intact |
| `known-honeypots.json` | 15 mints | RugCheck honeypot-flagged |

Format:
```json
{
  "mint": "string",
  "poolAddress": "string",
  "source": "pumpfun | raydium-amm | …",
  "createdAt": 1747000000000,
  "label": "rug" | "good" | "honeypot",
  "expectedFailFilters": ["lp-locked", "honeypot-sim"],
  "notes": "Dev rug 2h after launch, LP unlocked"
}
```

### 5.2 Replay harness

New CLI: `pnpm engine:filter-test`

```
$ pnpm engine:filter-test --fixture known-rugs.json

Filter performance on 30 known rugs:
                       Detected   Missed   Precision   Recall   F1
honeypot-sim              28        2        100%       93%     0.96
lp-locked                 25        5        100%       83%     0.90
top-holders               18       12         85%       60%     0.70
…
```

### 5.3 Continuous validation

Per-filter precision/recall computed daily, surfaced on the Analytics page. Already have `FilterPerformance` type — extend with `precisionPct` and `recallPct` when fixture labels are known.

### 5.4 Acceptance gates per filter

A filter ships at "9/10" when:
- ≥40 fixture evaluations
- Precision ≥85%
- Recall ≥75% on the relevant fixture set
- No silent skips in real mode (every skip logged with reason)
- Confidence scores in use (not just pass/fail)

---

## 6. Phasing

### Phase A — Foundations (~3-4 days)

1. Confidence-score refactor (§3.1) — update `makeResult` + orchestrator
2. Exclusion registry (§3.2) — load known lockers, burn, vesting
3. Provider fallback chain (§3.3) — at least RugCheck → Solsniffer
4. Filter test harness (§3.4) — CLI + fixture format
5. Curate first 30 fixtures (mostly your time — pull from RugCheck)

**Exit gate**: harness runs against fixtures, baseline precision/recall numbers locked for all 12 filters.

### Phase B — Highest-impact fixes (~3-4 days)

1. `lp-locked` real-mode implementation (§ Filter 2) — currently does nothing
2. `top-holders` exclusion + DAS migration (§ Filter 5)
3. `honeypot-sim` real-tx simulation (§ Filter 9)
4. `dev-wallet` fallback chain + on-chain scan (§ Filter 6)

**Exit gate**: precision/recall improves ≥15pp on each of the 4 filters above.

### Phase C — Sophistication upgrades (~4-5 days)

1. `insider-detection` multi-hop traversal + insider DB (§ Filter 8)
2. `bundled-launch` funding-graph clustering (§ Filter 7)
3. `social-signal` Twitter + WHOIS + metadata URI (§ Filter 10)
4. `volume-velocity` multi-window + unique buyers (§ Filter 11)
5. `anti-sniper-war` priority-fee weighting (§ Filter 12)
6. `mint/freeze-authority` multisig recognition (§ Filters 3-4)

**Exit gate**: every filter ≥85% precision on fixture set.

### Phase D — Production tracking (~2 days)

1. Daily precision/recall computation, write to `FilterPerformance`
2. Dashboard surfaces per-filter precision badge on Analytics page
3. Stale-fixture alerter — if a fixture mint's actual outcome diverges from label, prompt re-labeling

**Exit gate**: precision/recall visible per filter on dashboard, refreshed daily.

---

## 7. What's NOT in scope (explicit non-goals)

To keep this plan focused, the following are deliberately deferred:

- **New filter types** (AI sentiment, MEV-tracker, validator-correlation) — improve the 12 we have first
- **ML-derived thresholds** — handcrafted thresholds are fine until we have months of labeled data
- **Auto-tuning thresholds** — listed as 10/10 nice-to-have but not required to hit 9/10
- **Cross-chain extension** — Solana only
- **Real-time alerting on filter regressions** — daily compute is enough for now

---

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| Fixture curation takes longer than expected (need real mints + labels) | Start with 10 of each; expand to 30 as Phase B progresses |
| RugCheck/Solsniffer API rate limits hit during validation | Cache aggressively, run validation off-peak |
| Helius DAS not free tier | Verify free-tier limits before depending on it for top-holders |
| Provider downtime cascades through fallback chain | Circuit breaker per provider, surface in dashboard |
| Multisig recognition list is incomplete | Start with Squads (most popular), expand from there |
| Token2022 extension parsing complexity | Use `@solana/spl-token` v0.4+ which handles extensions; allocate buffer time |

**Open question for review**: which `pass score 50` defaults should hard-fail instead? Tighter defaults catch more rugs but reject more good tokens. The CEO review may want to lean one way or the other.

**Open question**: do we need per-DEX threshold sets? A "top holder >15%" threshold makes sense for Raydium AMM but might be wrong for pump.fun graduations where pre-graduation holders dominate by design.

---

## 9. Success criteria (the gate to call this done)

The plan is complete when **all** of these are true:

- [ ] Every filter scored ≥9/10 against the 8 criteria in §1
- [ ] Aggregate precision ≥85% across all 12 filters
- [ ] Aggregate recall ≥75% on `known-rugs.json`
- [ ] No filter returns `skip` in >5% of real-mode evaluations
- [ ] Every `FilterResult.metadata` carries `confidenceBasis` + numeric evidence
- [ ] Analytics page shows per-filter precision/recall, refreshed daily
- [ ] Filter test harness runs in CI on every commit
- [ ] CLAUDE.md / docs updated with the new conventions

---

## 10. What to do with this plan

Run `/plan-eng-review` on this file. Specifically ask the reviewer to challenge:

1. Is the 9/10 definition (§1) measurable and complete?
2. Are the per-filter target scores realistic given Solana data constraints?
3. Is the phasing right — should `lp-locked` go before the foundations work?
4. Have I missed any cross-cutting concern (caching, observability, error budgets)?
5. Are the fixture sizes (30 + 30 + 15) statistically sufficient?

Optionally also `/plan-ceo-review` to challenge scope:
- Should we add new filter types instead of perfecting existing ones?
- Is "filter quality" the right place to invest vs (e.g.) execution latency?

After review, the resulting hardened plan replaces §§ 4 + 6 with the agreed approach, and we begin implementation.

---

## 11. Hardened plan deltas (from /plan-eng-review)

The sections below supersede or amend the corresponding original sections. Originals are preserved above for audit.

### 11.1 §1 — Updated 9/10 definition

Add to the criteria table:

| Criterion | What it means |
|---|---|
| **Structured evidence** | `FilterResult.metadata.evidence` carries machine-readable counts/percentages/addresses (free-text `reason` stays for humans) |
| **Filter version tag** | Every result carries `filterVersion` (semver). PoolDecision aggregates seen versions. Daily precision computation buckets by version. |
| **Paper-PnL lift** | Per-filter `lift = winRate_passed − baseline winRate` is ≥0 over a rolling 7-day window with ≥50 closed positions. |

### 11.2 §3.1 — Confidence scores: call-site audit + status policy (replaces §3.1)

The architecture already supports score×weight (orchestrator.ts:152, makeResult at types.ts:50). The actual work is:

1. **`confidenceBasis` field on FilterResult.metadata.** Enum: `on-chain | rugcheck | dexscreener | helius-das | birdeye | solsniffer | cache | no-data | partial-providers`.
2. **`makeResult` contract tightened.** `score` is REQUIRED when `status === "pass"`. Auto-default only for fail/skip/error. TypeScript-enforced.
3. **Status policy (new).** Per-filter table documenting which evidence path returns which status:
   - **HARD-FAIL** when filter has high-confidence negative evidence (e.g. mint authority confirmed not renounced, top1 holder confirmed >50%, honeypot sim confirmed unsellable).
   - **PASS with low confidence (score 30-60)** when evidence is partial (provider chain hit only N-1 of N providers, unknown wallet with no on-chain history).
   - **SKIP** when no data is reachable (all providers exhausted, pool too fresh, structural N/A like pump.fun pre-graduation).
   - **ERROR** only for actual code exceptions, not "data unavailable."
4. **Per-filter call-site table** in this section listing today's score-by-branch and target score-by-branch — implementer follows the table.

Verdict-drift consequence: orchestrator.ts:154 hard-rejects on any fail, so moving a branch from fail→low-confidence-pass changes the verdict on those pools. See §11.13 baseline-backtest gate.

### 11.3 §3.2 — Exclusion registry (amended)

Original §3.2 stands. Add: the registry has TWO layers.
- **Static** (boot-loaded): known lockers, burn addresses, well-known multisig PDAs.
- **Dynamic per-pool** (computed at evaluation time): LP pool's token-account address, populated via §11.6 dex-decoder. Top-holders MUST consult both. Static-only exclusion misses the LP-account-as-top-holder case for every new pool.

### 11.4 §3.3 — Provider fallback chain: two-layer (replaces §3.3)

Two-layer split:

- **Low-level: `ProviderClient` interface.** One per provider (RugCheckClient, SolsnifferClient, HeliusDasClient, BirdeyeClient, DexScreenerClient, GeckoTerminalClient). Owns HTTP, timeout, exponential backoff, per-provider circuit-breaker, raw response shape.
- **High-level: typed domain queries.** `lookupHolderDistribution(mint): Promise<HolderDistribution>`, `lookupDevHistory(wallet): Promise<DevHistory>`, `lookupPairInfo(pool): Promise<PairInfo>`, etc. Each iterates a typed list of clients in priority order and normalizes raw responses to a typed domain object.
- **All-providers-exhausted contract.** When every client in a chain fails or has a tripped breaker: query returns `{ ok: false, reason: "all-providers-exhausted" }`. Filters must then return `status: "skip"` with `confidenceBasis: "no-data"` and emit a `provider-outage` dashboard event. Bot becomes conservative under outage (fewer snipes), never permissive.

### 11.5 §3.4 — Filter test harness: reuse backtest.ts (replaces §3.4)

`analytics/backtest.ts:runBacktest()` already replays persisted PoolEvents through the orchestrator and emits verdicts. The harness is a thin layer on top:

1. Extend `runBacktest` to accept an optional `poolsOverride: PoolEvent[]` (defaults to DB-loaded). One added parameter.
2. New `scripts/filter-test.ts` CLI:
   - Loads JSON fixtures from `apps/engine/fixtures/`.
   - Calls `runBacktest(orch, { poolsOverride, presetName: 'test' })`.
   - Joins verdicts with labeled truth → computes per-filter TP/FP/TN/FN → precision, recall, F1 → confusion matrix.
3. Output: markdown table per filter + JSON dump to `.harness-results/`.
4. CI script: `pnpm engine:filter-test --fixture all --ci` exits non-zero if any filter regresses precision by >5pp vs the committed `baseline-precision.json`.

### 11.6 §3.11 (NEW) — Shared dex-decoder module

`apps/engine/src/feeds/dex-decoder.ts`. Single source of truth for per-DEX layout decoding. Returns:

```ts
interface PoolDecoded {
  source: "raydium-amm" | "raydium-clmm" | "pumpswap" | "pumpfun-bonding";
  lpMint: string | null;        // null for pump.fun pre-graduation
  lpPoolTokenAccount: string;   // the AMM's holding of project token — exclude from top-holders
  baseTokenVault: string;
  quoteTokenVault: string;
}
```

Used by Filter 2 (lp-locked) to find the LP mint, Filter 5 (top-holders) to populate the dynamic exclusion entry. Filter 5 BLOCKS-BY this module. Phase A foundation work.

### 11.7 §3.12 (NEW) — Shared funding-graph module

`apps/engine/src/feeds/funding-graph.ts`. Used by Filter 7 (bundled-launch clustering) and Filter 8 (insider multi-hop). Exports:

```ts
traceFunders(wallet: string, maxHops: number): Promise<FunderChain[]>;
clusterByCommonFunder(wallets: string[], maxHops: number): Promise<Cluster[]>;
```

Cycle detection mandatory. Internal LRU cache (TTL 30 min). Per-call hop limit enforced. Filter 7 uses `clusterByCommonFunder` on first 20 buyers. Filter 8 uses `traceFunders` on the dev wallet. Insider DB lookup happens at the filter call-site; module stays pure-graph.

### 11.8 §3.10 (NEW) — Filter scaffold helpers

`apps/engine/src/filters/_scaffold.ts`:

- `createTtlCache<K, V>({ ttlMs, maxEntries, name }): TtlCache<K, V>` — single LRU+TTL impl. Per-instance hit/miss counters exposed via dashboard metrics. Replaces the four Map+TTL patterns in dev-wallet.ts, insider-detection.ts, bundled-launch.ts, anti-sniper-war.ts.
- `withSyntheticShortCircuit(id, ctx, mockFn)` — returns FilterResult (synthetic case) or undefined (real-mode). Replaces the boilerplate `if (ctx.isSynthetic && ctx.syntheticMock) { ... }` prelude in all 12 filters.
- Refactor 4 existing filters as the baseline. All new filter work uses the helpers.

### 11.9 §3.7 (NEW) — RPC budget table

Per-evaluation RPC cost ceiling per filter (cache-miss path):

| Filter | RPCs/eval | Notes |
|---|---|---|
| 2 lp-locked | 2 | AMM decode + getTokenLargestAccounts(lpMint) |
| 5 top-holders (DAS) | ≤10 | Paginated, capped at 200 top holders |
| 6 dev-wallet on-chain fallback | ≤20 | Scan last 20 launches |
| 7 bundled-launch | ≤17 | sigs + 8 parsed-tx + 8 funder traces |
| 8 insider 3-hop | ≤30 | 3 × (sigs + ~10 parsed-tx) per uncached hop |
| 9 honeypot simulateTx | 1 heavy | counts as ~5 simple reads in QuickNode tier |
| 12 anti-sniper priority-fee | ≤8 | sigs + parsed-tx batch |

Target: ≤80 RPCs per pool that passes all early filters. At 1000 pools/day expected throughput: ≤80k RPC/day. With 50% headroom: ≤120k. QuickNode Build tier 833k/day → ~14% budget. Document tier upgrade triggers.

### 11.10 §3.8 (NEW) — Global RPC rate limiter

`apps/engine/src/state/rpc.ts` is the only place RPC connections are created. Wrap the `Connection` in a Bottleneck-style proxy:
- Max N concurrent (env tunable, default 20)
- Max M req/sec (env tunable, default 50)
- Per-method weighting (`simulateTransaction` counts as 5)
- Token-bucket on top, NOT in addition to PQueue

All filters share. Dashboard surfaces `rpc.concurrency.peak`, `rpc.rps`, `rpc.throttled.count`.

### 11.11 §3.9 (NEW) — Shared parsed-tx cache

Move parsed-tx caching into `feeds/parsers/common.ts` as `fetchParsedTxCached(conn, sig)`. Single LRU, 500 entries, 5-min TTL. Replaces local caches in bundled-launch, insider-detection. Expected hit rate ~40% across filters that touch overlapping signatures.

### 11.12 §3.13 (NEW) — FlaggedWallet unified schema

Replace `RuggedDevWallet` + new `KnownInsiderWallet` with one model:

```prisma
model FlaggedWallet {
  address       String   @id
  roles         String[] // ["rugger", "insider", "funder"]
  rugRate       Float?
  totalLaunches Int?
  sources       String[] // ["rugcheck", "birdeye", "manual"]
  confidence    Int      // 0-100
  notes         String?
  updatedAt     DateTime @updatedAt
}
```

Migration: existing `RuggedDevWallet` rows → `FlaggedWallet` with `roles=["rugger"]`. Migration script preserves all columns. **Regression-test mandatory**: query both schemas for the same wallet list, compare results.

### 11.13 §3.14 (NEW) — Permissive-defaults policy

Single coordinated pass:
- Enumerate every filter's no-data branch.
- Assign a target score (10-40 based on signal weight: critical filters get lower fallback scores).
- All no-data branches must include `confidenceBasis: "no-data"` so dashboard can flag.
- Land as one PR with a baseline backtest snapshot before/after (see §11.14).

### 11.14 §3.15 (NEW) — Baseline backtest gates for verdict-changing PRs

Before any PR that changes filter status policy, score defaults, or schema:

1. Run `runBacktest` on last 200 persisted pools at HEAD-1 → snapshot `baseline-{change}.json` (per-filter pass/fail/skip counts, aggregate snipe rate).
2. Apply change. Re-run on same 200 pools.
3. Fail if: snipe rate shifts >15pp without justification OR any filter's pass-rate shifts >20pp without justification.
4. Justification is a comment in the PR description tying the shift to a specific design intent.

Required gate for: §11.2 confidence-score audit, §11.12 schema migration, §11.13 permissive-defaults tightening.

### 11.15 §3.16 (NEW) — Filter version tags

- Each filter exports `export const FILTER_VERSION = "1.0.0";` constant. Bumped on any change to status policy, scoring, or evidence logic.
- `FilterResult.metadata.filterVersion = FILTER_VERSION` set by `makeResult`.
- Prisma migration: add `filterVersion String?` to `FilterResult`.
- `filter-performance.ts:computeFilterPerf` aggregates per-version stats. Dashboard renders most-recent-version metrics + version-history sparkline.

### 11.16 §3.17 (NEW) — Outcome-based fixture labels

Drop provider-derived labels. Define on-chain truth:
- **Rug**: `liquidityUsd dropped >90% within 24h of pool detection AND creator wallet had a SOL withdrawal during the drop window`.
- **Good**: `pool survived >7 days with liquidityUsd ≥ 50% of peak`.
- **Honeypot**: `0 successful sell-direction swaps over the pool lifetime`.

`scripts/label-fixtures.ts` walks on-chain history and emits labels. Run once per fixture batch. Removes the RugCheck-validates-RugCheck circularity.

### 11.17 §5.1 — Tiered fixtures (replaces §5.1)

Three tiers:
- **Phase A ship**: 20 rugs + 20 good + 10 honeypots = 50 mints.
- **Phase B exit gate**: 30 + 30 + 15 = 75.
- **Phase C exit gate / §9 §11.18 acceptance**: 60 + 60 + 30 = 150.

Plus a **live-validation loop**: any pool whose actual on-chain outcome diverges from the filter verdict by >X (e.g. bot rejected → token survived >7d with strong liquidity) gets auto-flagged for fixture-set inclusion review.

### 11.18 §9 — Updated success criteria (replaces §9)

The plan is complete when **all** of these are true:

- [ ] Every filter scored ≥9/10 against the criteria in §1 + §11.1
- [ ] Aggregate precision ≥85% across all 12 filters on the 150-mint fixture set (n=150 narrows CI to ~±6pp)
- [ ] Aggregate recall ≥75% on the rug subset
- [ ] **Per-filter paper-PnL lift ≥0** over a rolling 7-day window with ≥50 closed positions
- [ ] **Aggregate paper PnL positive** over the same window
- [ ] No filter returns *unexplained* skip in >5% of real-mode evaluations. Provider-exhaustion skips and structural skips (pump.fun pre-graduation, fresh-pool grace) are excluded and tracked separately on the dashboard.
- [ ] Every `FilterResult.metadata` carries `confidenceBasis` + `evidence` + `filterVersion`
- [ ] Analytics page shows per-filter precision/recall + PnL lift + filterVersion, refreshed daily
- [ ] Filter test harness runs in CI on every commit (precision regression gate at >5pp)
- [ ] CLAUDE.md / docs updated with the new conventions

### 11.19 §6 — Updated phasing + dependencies (replaces §6)

Honest timeline: **3-4 weeks**, not 13-15 days. Dependencies explicit.

**Phase A — Foundations (~5-7 days)**

Order matters; some items unblock per-filter work.

1. Add Vitest + first unit-test infrastructure (T1)
2. `_scaffold.ts` cache + synthetic helpers (T2) — refactor 4 existing filters as baseline
3. `FilterResult` contract: required-score + `evidence` + `filterVersion` + `confidenceBasis` (T3)
4. Status-policy table per filter (T4) — drives §11.2
5. `exclusion-registry.ts` static layer (T5)
6. `dex-decoder.ts` (T6) — Raydium AMM/CLMM, PumpSwap, pump.fun
7. `funding-graph.ts` (T7) — multi-hop traversal with cycle detection
8. `provider-chain.ts` two-layer (T8) — RugCheck + Solsniffer clients first
9. Global RPC rate limiter (T9)
10. Shared parsed-tx cache (T10)
11. `FlaggedWallet` migration from `RuggedDevWallet` (T11) + regression test
12. Permissive-defaults audit + baseline backtest (T12) — coordinated PR
13. Filter test harness extension on backtest.ts (T13)
14. Outcome-based label script (T14) + curate first 50 fixtures
15. RPC budget table committed to docs (T15)

Exit gate: vitest suite green, harness runs against 50 fixtures, baseline-precision.json committed.

**Phase B — Highest-impact fixes (~5-7 days)**

Each runs with a baseline backtest gate (§11.14).

16. `lp-locked` real-mode (Filter 2) — depends on T5, T6
17. `top-holders` exclusion + DAS migration (Filter 5) — depends on T5, T6, T8
18. `dev-wallet` 3-tier chain + on-chain fallback (Filter 6) — depends on T8
19. `honeypot-sim` Token2022 transferFee + signed-sim (Filter 9)

Exit gate: precision/recall improves ≥15pp on each filter; baseline snapshots written.

**Phase C — Sophistication upgrades (~7-10 days)**

20. `insider-detection` 3-hop traversal + FlaggedWallet (Filter 8) — depends on T7, T11
21. `bundled-launch` funding-graph clustering (Filter 7) — depends on T7, T10
22. `social-signal` Twitter API + WHOIS + Metaplex URI (Filter 10)
23. `volume-velocity` multi-window + unique buyers (Filter 11)
24. `anti-sniper-war` priority-fee weighting + buy detection (Filter 12) — depends on T10
25. `mint/freeze-authority` multisig recognition (Squads + Realms) (Filters 3-4)

Exit gate: every filter ≥85% precision on 75-mint fixture set; PnL lift tracked.

**Phase D — Production tracking + scale-up (~3-4 days)**

26. Daily precision/recall + PnL lift computation
27. Dashboard surfaces per-filter precision + version + lift badges
28. Stale-fixture alerter
29. Provider-outage badge + dashboard alert plumbing
30. Expand fixtures to 150 (Phase C exit gate)

Exit gate: §11.18 success criteria fully met.

---

## 12. TODOs (deferred items, captured for later)

These were considered during the eng review and explicitly deferred. They are not in scope for the current plan.

- **Token2022 deep extension coverage.** Plan covers transferFee. Defer: transfer hooks (arbitrary on-transfer code), permanent delegate (any-to-any transfer), default account state (frozen-by-default), confidential transfers. Adoption among memecoins is near-zero today; revisit when landscape shifts. Filter 9 should at least *detect and log* the presence of these extensions even if it doesn't gate on them.
- **Multisig recognition expansion.** Phase C ships with Squads + Realms (~80% of legit-multisig cases). Expand to Goki, native SPL Multisig, top-3 DAO frameworks once we see false-positive rate on legit projects in real-mode logs.
- **ML-derived thresholds + auto-tuning.** Already non-goal in §7. Revisit once 90 days of labeled outcome data is collected.
- **DEX layout refresh cadence.** Solana DEX landscape ships new variants (LetsBonk, Believe, Boop, Moonshot, etc.) monthly. `dex-decoder.ts` will rot. Need a quarterly review process: which new DEXes have >5% pool share, audit decoder coverage, update `exclusion-registry` for new lockers/pools.

---

## 13. Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

### Phase A — Foundations

- [ ] **T1 (P1, human: ~0.5d / CC: ~10min)** — engine — Add Vitest + `pnpm test` scripts + first smoke test
  - Surfaced by: Section 3 — no test framework in repo
  - Files: `apps/engine/package.json`, `apps/engine/vitest.config.ts`, `apps/engine/src/__tests__/smoke.test.ts`
  - Verify: `pnpm --filter @sniperbot/engine test` exits 0
- [ ] **T2 (P1, human: ~0.5d / CC: ~20min)** — filters/_scaffold — Shared cache + synthetic-prelude helpers
  - Surfaced by: Issue 8 — DRY violation across 4 filter caches
  - Files: `apps/engine/src/filters/_scaffold.ts`, refactor `dev-wallet.ts`, `insider-detection.ts`, `bundled-launch.ts`, `anti-sniper-war.ts`
  - Verify: vitest unit tests on cache TTL + LRU eviction; existing filter behavior unchanged on baseline backtest
- [ ] **T3 (P1, human: ~0.5d / CC: ~15min)** — filters/types — `FilterResult` contract: required score + evidence + filterVersion + confidenceBasis
  - Surfaced by: Issue 9 — `makeResult` silently defaults score to 100
  - Files: `apps/engine/src/filters/types.ts`, `packages/shared/src/types/filter.ts`, prisma schema (`filterVersion` column), migration
  - Verify: TypeScript fails to compile if a pass result omits score; FilterResult.metadata.evidence/filterVersion populated in tests
- [ ] **T4 (P1, human: ~0.5d / CC: ~30min)** — docs — Per-filter status-policy table
  - Surfaced by: Cross-model tension 1 — status vs score
  - Files: `apps/engine/src/filters/STATUS_POLICY.md` (new), references in each filter file
  - Verify: every existing filter branch maps to an entry in the table
- [ ] **T5 (P1, human: ~0.5d / CC: ~20min)** — state — `exclusion-registry.ts` static layer (lockers + burns + multisig PDAs)
  - Surfaced by: Issue 3 — top-holders LP exclusion + plan §3.2
  - Files: `apps/engine/src/state/exclusion-registry.ts`, fixture YAML for known addresses
  - Verify: `isExcluded(burnAddr)` returns true; vitest covers load + query
- [ ] **T6 (P1, human: ~1.5d / CC: ~45min)** — feeds — `dex-decoder.ts` for Raydium AMM/CLMM + PumpSwap + pump.fun bonding curve
  - Surfaced by: Issue 3 — Filter 5 sequencing dependency
  - Files: `apps/engine/src/feeds/dex-decoder.ts`, vitest with byte-fixture for each layout
  - Verify: decode → `{ lpMint, lpPoolTokenAccount, baseVault, quoteVault }` for one known pool per source
- [ ] **T7 (P1, human: ~1d / CC: ~30min)** — feeds — `funding-graph.ts` with cycle detection + LRU cache
  - Surfaced by: Issue 4 — shared between Filter 7 + 8
  - Files: `apps/engine/src/feeds/funding-graph.ts`, vitest covering cycle + hop-limit
  - Verify: `traceFunders(walletA, 3)` returns chain; injected cycle terminates; cache TTL works
- [ ] **T8 (P1, human: ~1d / CC: ~30min)** — feeds — Two-layer `provider-chain.ts` + RugCheck + Solsniffer clients
  - Surfaced by: Issue 5 — provider chain under-specified
  - Files: `apps/engine/src/feeds/provider-chain.ts`, `apps/engine/src/feeds/providers/*.ts`
  - Verify: vitest covers timeout, breaker trip + reset, all-exhausted contract returns `{ ok: false }`
- [ ] **T9 (P1, human: ~0.5d / CC: ~20min)** — state — Global RPC rate limiter wrapping `Connection`
  - Surfaced by: Issue 15 — RPC concurrency cap
  - Files: `apps/engine/src/state/rpc.ts`, vitest with mock connection
  - Verify: bursts above concurrency cap queue; dashboard metric exposed
- [ ] **T10 (P1, human: ~0.25d / CC: ~10min)** — feeds — Shared parsed-tx LRU cache
  - Surfaced by: Issue 16
  - Files: `apps/engine/src/feeds/parsers/common.ts`, replace local maps in bundled-launch + insider
  - Verify: hit-rate metric exposed; behaviorally unchanged on baseline backtest
- [ ] **T11 (P1, human: ~1d / CC: ~30min)** — state/db — `FlaggedWallet` schema + migration from `RuggedDevWallet`
  - Surfaced by: Issue 7 — unified schema
  - Files: prisma schema, migration script, `apps/engine/scripts/migrate-flagged-wallets.ts`, regression test
  - Verify: every row in `RuggedDevWallet` appears in `FlaggedWallet` with `roles=["rugger"]`; queries match
- [ ] **T12 (P1, human: ~0.5d / CC: ~15min)** — filters — Permissive-defaults coordinated audit + baseline backtest
  - Surfaced by: Issue 10 + Issue 12
  - Files: per-filter score adjustments, baseline snapshot in `apps/engine/baselines/permissive-defaults.json`
  - Verify: snipe rate shift documented in PR; passes baseline gate
- [ ] **T13 (P2, human: ~1d / CC: ~30min)** — analytics — Extend backtest.ts with fixture-mode + harness CLI
  - Surfaced by: Issue 2 — reuse backtest.ts
  - Files: `apps/engine/src/analytics/backtest.ts` (add `poolsOverride` param), `apps/engine/scripts/filter-test.ts`
  - Verify: `pnpm engine:filter-test --fixture known-rugs.json` outputs per-filter precision/recall
- [ ] **T14 (P2, human: ~1d / CC: ~30min)** — scripts — Outcome-based fixture labeling
  - Surfaced by: Cross-model tension 2 — circular labels
  - Files: `apps/engine/scripts/label-fixtures.ts`, `apps/engine/fixtures/{known-rugs,known-good,known-honeypots}.json`
  - Verify: 50 mints labeled from on-chain history, no provider involvement
- [ ] **T15 (P3, human: ~0.25d / CC: ~10min)** — docs — RPC budget table committed
  - Surfaced by: Issue 14
  - Files: `apps/engine/RPC_BUDGET.md`
  - Verify: file present, table covers all 12 filters

### Phase B — Highest-impact filters

- [ ] **T16 (P1, human: ~1.5d / CC: ~45min)** — filters/lp-locked — Real-mode implementation
  - Surfaced by: Plan §4 Filter 2; depends on T5 + T6
- [ ] **T17 (P1, human: ~1.5d / CC: ~45min)** — filters/top-holders — Exclusion + DAS migration with pagination cap
  - Surfaced by: Plan §4 Filter 5; depends on T5 + T6 + T8
- [ ] **T18 (P1, human: ~1d / CC: ~30min)** — filters/dev-wallet — 3-tier chain + on-chain fallback
  - Surfaced by: Plan §4 Filter 6; depends on T8
- [ ] **T19 (P1, human: ~1.5d / CC: ~45min)** — filters/honeypot-sim — Token2022 transferFee + signed-sim
  - Surfaced by: Plan §4 Filter 9

### Phase C — Sophistication

- [ ] **T20 (P1, human: ~1d / CC: ~30min)** — filters/insider-detection — 3-hop traversal + FlaggedWallet lookup
  - Surfaced by: Plan §4 Filter 8; depends on T7 + T11
- [ ] **T21 (P1, human: ~1d / CC: ~30min)** — filters/bundled-launch — Funding-graph clustering
  - Surfaced by: Plan §4 Filter 7; depends on T7 + T10
- [ ] **T22 (P2, human: ~1.5d / CC: ~45min)** — filters/social-signal — Twitter API + WHOIS + Metaplex URI
  - Surfaced by: Plan §4 Filter 10
- [ ] **T23 (P2, human: ~0.5d / CC: ~15min)** — filters/volume-velocity — Multi-window + unique buyers
  - Surfaced by: Plan §4 Filter 11
- [ ] **T24 (P2, human: ~0.5d / CC: ~15min)** — filters/anti-sniper-war — Priority-fee weighting + buy detection
  - Surfaced by: Plan §4 Filter 12; depends on T10
- [ ] **T25 (P2, human: ~0.5d / CC: ~15min)** — filters/mint-and-freeze-authority — Squads + Realms multisig recognition
  - Surfaced by: Plan §4 Filters 3-4

### Phase D — Production tracking

- [ ] **T26 (P1, human: ~1d / CC: ~30min)** — analytics — Daily precision/recall + PnL lift, per filterVersion
  - Surfaced by: Cross-model tension 4 + Plan §6 Phase D
- [ ] **T27 (P2, human: ~0.5d / CC: ~15min)** — dashboard — Per-filter badges + version + lift
- [ ] **T28 (P2, human: ~0.25d / CC: ~10min)** — dashboard — Provider-outage alert plumbing
  - Surfaced by: Issue 6
- [ ] **T29 (P2, human: ~0.5d / CC: ~15min)** — scripts — Stale-fixture alerter
- [ ] **T30 (P3, human: ~1d / CC: ~30min)** — fixtures — Expand to 150 mints (60/60/30)
  - Surfaced by: Issue 13

---

## 14. Worktree parallelization

Phase A has high parallelism once T1 + T3 land (test infra + result contract are coupling points).

| Step | Modules touched | Depends on |
|---|---|---|
| T1 Vitest | engine root + package.json | — |
| T2 _scaffold | filters/_scaffold.ts + 4 filter refactors | T1 |
| T3 Result contract | filters/types.ts + shared/types + prisma | T1 |
| T4 Status policy doc | docs | — |
| T5 Exclusion registry static | state/exclusion-registry | T1 |
| T6 dex-decoder | feeds/dex-decoder | T1 |
| T7 funding-graph | feeds/funding-graph | T1 |
| T8 provider-chain | feeds/provider-chain | T1, T9 (rate limiter) |
| T9 RPC rate limiter | state/rpc | T1 |
| T10 Parsed-tx cache | feeds/parsers/common | T1, T2 (cache helper) |
| T11 FlaggedWallet migration | prisma + state/db | — |
| T12 Permissive defaults | filters/* | T3, T13 |
| T13 Harness extension | analytics/backtest + scripts | T1 |
| T14 Outcome labeling | scripts/label-fixtures | T1 |

**Phase A lanes (after T1+T3 land):**

```
Lane A1: T1 → T3 → T12              (result contract + permissive defaults — touches all filters, serial)
Lane A2: T1 → T2 → T10               (scaffold + parsed-tx cache — depend on cache helper)
Lane A3: T1 → T4                     (status policy doc — independent)
Lane A4: T1 → T5                     (exclusion registry — independent)
Lane A5: T1 → T6                     (dex-decoder — independent)
Lane A6: T1 → T7                     (funding-graph — independent)
Lane A7: T1 → T9 → T8                (rate limiter + provider chain)
Lane A8: T1 → T11                    (FlaggedWallet — schema change, isolated)
Lane A9: T1 → T13 → T14              (harness extension + labeling)
```

A2-A9 can run as parallel worktrees once T1 lands. Lane A1 is the serial backbone (everything in `filters/*` flows through it).

**Phase B (after Phase A complete):**

```
Lane B1: T16 (lp-locked)             [touches filters/, depends on T5+T6]
Lane B2: T17 (top-holders)           [touches filters/, depends on T5+T6+T8]
Lane B3: T18 (dev-wallet)            [touches filters/, depends on T8]
Lane B4: T19 (honeypot-sim)          [touches filters/, independent]
```

**Conflict flag**: B1, B2, B3, B4 all touch `apps/engine/src/filters/*` and share `_scaffold.ts` consumption. Likely merge conflicts on `registry.ts` if multiple lanes ship simultaneously. Mitigation: serialize merges (each lane ships its filter file in isolation; merge to main between lanes).

**Phase C:**

```
Lane C1: T20 (insider) + T21 (bundled) [both depend on T7 + T10, share parsed-tx cache]
Lane C2: T22 (social)                  [independent, paid-API integration]
Lane C3: T23 + T24 + T25               [smaller filter touchups, can serialize on one lane]
```

C1's two filters touch `feeds/funding-graph.ts` consumption similarly — review for coordinated changes.

---

## 15. What already exists

Existing code that the plan partially-duplicates or builds on:

- **`apps/engine/src/analytics/backtest.ts`** — replays persisted PoolEvents through the orchestrator with a config override. The filter test harness (§3.4 / §11.5) is a thin layer on top, not a parallel system.
- **`apps/engine/src/analytics/filter-performance.ts`** — computes per-filter passed-trades, win-rate, lift over baseline. Daily precision/recall computation extends this rather than starting from scratch.
- **`apps/engine/src/filters/types.ts:makeResult`** — already accepts `score`. Confidence-score architecture exists; the work is a call-site audit + contract tightening (§11.2).
- **`apps/engine/src/filters/orchestrator.ts:computeVerdict`** — already weights `score × weight`. Hard-rejects on any fail (§11.2 status policy must respect this).
- **`apps/engine/src/filters/insider-detection.ts:findFunder`** — one-hop traversal. Extend, don't replace, when building `funding-graph.ts` (T7).
- **`apps/engine/src/state/db.ts` + Prisma `RuggedDevWallet`** — existing flagged-wallet store. Migrate, don't add alongside (T11).
- **`apps/engine/src/feeds/parsers/common.ts:fetchParsedTx`** — exists, no cache. Add LRU around it (T10).

---

## 16. NOT in scope (after eng review)

- **Token2022 extensions beyond transferFee.** Deferred in §12 TODOs. Filter 9 will detect-and-log other extensions but not gate on them.
- **Multisig recognition beyond Squads + Realms.** Deferred in §12 TODOs.
- **ML auto-tuning thresholds.** Already non-goal in original §7.
- **Cross-chain extension.** Already non-goal in original §7.
- **Live wallet code.** Plan is paper-trading-only.
- **PnL gate before Phase D.** Per cross-model tension 3, PnL lift is a §11.18 success criterion, but reaching ≥50 closed positions requires Phase A-C to ship first. Don't block per-filter PRs on PnL until Phase D.
- **Real-time regression alerting.** Daily compute on the dashboard is the budget; pager-style alerting is out.

---

## 17. Failure modes (per new codepath)

| New module | Realistic failure | Has test? | Has handler? | User signal? |
|---|---|---|---|---|
| `provider-chain.ts` all-providers down | All 3 providers 503 | T8 vitest | Returns `{ok:false}` → filter skip | Dashboard outage badge — **CRITICAL: must surface or the bot quietly snipes everything** |
| `funding-graph.ts` cycle in funder chain | A funds B funds A | T7 vitest | Cycle-detection terminates | log warn, filter sees truncated chain |
| `dex-decoder.ts` unknown DEX | New DEX not in decoder | T6 vitest | Returns null → Filter 2 skips with reason | log warn + dashboard "unknown-dex" counter |
| `funding-graph.ts` RPC timeout | Slow QuickNode | T7 vitest | Per-hop timeout → partial chain | filter returns skip if depth < 2 |
| RPC rate limiter saturation | Burst of pools | T9 vitest | Token-bucket queues | dashboard `rpc.throttled` metric |
| Parsed-tx cache memory bloat | Long-running engine | T10 vitest | LRU eviction caps at 500 entries | metric: cache size |
| FlaggedWallet migration | Disk full during migrate | T11 regression | Migration script transactional + dry-run flag | manual restore from backup |
| Token2022 transferFee on Filter 9 | Mint has the extension | T19 vitest + fixture | Filter fails with `reason: transferFee > max` | **CRITICAL: must fail loudly** |
| Outcome-based labeling | Pool deleted from chain history | T14 | Skip mint with log | labeling script reports `missing: N` |
| filterVersion drift on dashboard | Mid-rollout dashboard view | T26 | Aggregate buckets by version | sparkline visible per filter |

No silent failures identified. CRITICAL items have explicit error contracts.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | outside voice (Claude subagent fallback) surfaced 9 points, 6 substantive cross-model tensions all resolved into the plan |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 16 issues across 4 sections + 2 TODOs + 6 cross-model tensions; all folded into §11 hardened deltas. 0 unresolved decisions, 0 critical gaps. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run (engine-heavy plan, minimal UI surface) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** Outside voice via Claude subagent (Codex CLI not installed). Surfaced status-vs-score conflation, circular fixture labels, N=30 statistical noise, scope rot vs 13-15 day timeline, DEX layout rot, missing filterVersion, silent-skip / provider-outage contradiction, Helius DAS free-tier blocker, missing PnL gate.
- **CROSS-MODEL:** 6 tension points presented to user via AskUserQuestion; all resolved with explicit recommendations applied to §11.2, §11.16, §11.18, §11.15 + §3.16, §11.19, §11.18 silent-skip wording.
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — plan hardened with §11 deltas, ready to implement. Recommended next steps: `/plan-ceo-review` if you want a scope/strategy second pass, otherwise `/ship` once Phase A T1-T15 land.

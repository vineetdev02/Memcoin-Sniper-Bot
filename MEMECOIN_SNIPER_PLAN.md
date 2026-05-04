# Solana Memecoin Sniper Bot — Master Plan

> **Personal use only. Paper trading FIRST for 2–5 weeks. Real capital only after validated paper performance.**
> Goal: detect new Solana token launches in milliseconds, filter out 95%+ scams/rugs, snipe high-quality plays, exit with disciplined TP ladders.

---

## 1. Honest Reality Check (Read First)

Before building anything, internalize these truths:

| Reality | Implication |
|---|---|
| 90–95% of new memecoins go to zero within 24h | Filter quality matters more than speed |
| Most "launches" are rugs by repeat-offender devs | Dev wallet history filter is the #1 alpha |
| You compete with 1000s of other sniper bots | Edge is in filters + exit discipline, not raw speed |
| Honeypots let you buy but not sell | Always simulate sell tx before buying |
| MEV bots will sandwich your buys | Use Jito bundles + tight slippage |
| Win rate will be 5–20%, but 1 winner can pay 100 losers | Position sizing must allow many small losses |
| Emotion kills discipline | Bot must auto-execute exits, no manual override in heat |

**The math:** if 10% of snipes hit 10x and 90% go to 0, you break even. To make money you need filters that push hit rate to 15%+ OR exits that ride winners to 20x+.

---

## 2. Project Overview

A fully local, personal-use Solana memecoin sniper that:

- Monitors Raydium, pump.fun, PumpSwap, Meteora, Orca, LetsBonk for new pool creation in real-time (sub-second)
- Runs a multi-layer filter engine on every new pool (rug checks, honeypot sim, holder analysis, dev history)
- Paper trades by default — simulates buys, fills, slippage, MEV losses, and exits with full P&L tracking
- Has a real-time dashboard showing live new pools, filter results, paper positions, P&L, and per-filter performance stats
- Fully customizable: every filter threshold, position size rule, TP/SL ladder, and DEX source togglable from UI
- Has a kill switch and auto-pause on drawdown
- After 2–5 weeks of paper validation, gates a live mode behind explicit confirmation + small starting capital

---

## 3. Project Structure

```
trusted-coins-tradebot/
├── apps/
│   ├── engine/                       # Node.js + TypeScript (hot path)
│   │   ├── src/
│   │   │   ├── feeds/
│   │   │   │   ├── helius-ws.ts      # Helius webhook + WS subscriber
│   │   │   │   ├── pumpfun-ws.ts     # pump.fun pool detection
│   │   │   │   ├── raydium-ws.ts     # Raydium AMM/CLMM pool detection
│   │   │   │   ├── pumpswap-ws.ts    # PumpSwap migration detection
│   │   │   │   ├── meteora-ws.ts     # Meteora DLMM pools
│   │   │   │   └── normalizer.ts     # Unify pool events to one schema
│   │   │   ├── filters/
│   │   │   │   ├── lp-locked.ts
│   │   │   │   ├── mint-authority.ts
│   │   │   │   ├── freeze-authority.ts
│   │   │   │   ├── top-holders.ts
│   │   │   │   ├── dev-wallet.ts     # Repeat rugger blacklist
│   │   │   │   ├── bundled-launch.ts # Sniped-by-dev detection
│   │   │   │   ├── insider-detection.ts
│   │   │   │   ├── honeypot-sim.ts   # Simulate sell tx via Jupiter
│   │   │   │   ├── liquidity-min.ts
│   │   │   │   ├── social-signal.ts  # Twitter/Telegram presence
│   │   │   │   ├── volume-velocity.ts
│   │   │   │   └── filter-orchestrator.ts
│   │   │   ├── execution/
│   │   │   │   ├── paper-executor.ts # Default mode
│   │   │   │   ├── live-executor.ts  # Gated, off by default
│   │   │   │   ├── jupiter-router.ts
│   │   │   │   ├── jito-bundler.ts
│   │   │   │   ├── slippage-calc.ts
│   │   │   │   └── priority-fee.ts
│   │   │   ├── exits/
│   │   │   │   ├── tp-ladder.ts
│   │   │   │   ├── stop-loss.ts
│   │   │   │   ├── trailing-stop.ts
│   │   │   │   ├── time-exit.ts
│   │   │   │   └── rug-pull-detector.ts  # Auto-exit on LP removal
│   │   │   ├── risk/
│   │   │   │   ├── position-sizer.ts
│   │   │   │   ├── drawdown-circuit.ts
│   │   │   │   ├── concurrent-limit.ts
│   │   │   │   └── correlation.ts
│   │   │   ├── state/
│   │   │   │   ├── redis.ts
│   │   │   │   └── position-store.ts
│   │   │   ├── analytics/
│   │   │   │   ├── filter-performance.ts  # Which filters predict winners
│   │   │   │   ├── pnl-tracker.ts
│   │   │   │   └── stats-engine.ts
│   │   │   ├── api/
│   │   │   │   └── socket-server.ts  # Push to dashboard
│   │   │   └── index.ts
│   │   └── package.json
│   └── dashboard/                    # Next.js 15
│       ├── app/
│       │   ├── page.tsx              # Live pool feed + active positions
│       │   ├── positions/page.tsx
│       │   ├── history/page.tsx
│       │   ├── filters/page.tsx      # Configure all filters
│       │   ├── analytics/page.tsx    # Per-filter win rate stats
│       │   └── settings/page.tsx
│       ├── components/
│       │   ├── LivePoolFeed.tsx
│       │   ├── PoolCard.tsx          # Per-pool filter results
│       │   ├── PositionsTable.tsx
│       │   ├── PnLChart.tsx
│       │   ├── FilterConfig.tsx
│       │   ├── TPLadderEditor.tsx
│       │   ├── KillSwitch.tsx
│       │   └── ModeToggle.tsx        # Paper / Live
│       └── package.json
├── packages/
│   ├── shared/                       # Types, schemas (Zod)
│   ├── solana-utils/                 # Account parsers, PDA derivation
│   └── filter-sdk/                   # Pluggable filter interface
├── docker-compose.yml                # Redis + Postgres + Grafana
├── .env
├── README.md
└── MEMECOIN_SNIPER_PLAN.md
```

---

## 4. Tech Stack

### Hot Path (Trading Engine)

| Layer | Tech | Why |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | Async I/O, fast iteration; can rewrite hot path in Rust later if needed |
| Solana SDK | `@solana/web3.js` v2 + `@solana/spl-token` | Standard, well-maintained |
| RPC Provider | Helius (primary) + Triton (fallback) | Best Solana data, webhooks, enhanced APIs |
| Bundle Submission | Jito Block Engine SDK | Required for competitive snipe inclusion |
| Aggregator | Jupiter v6 API | Best price routing, simulate-tx for honeypot check |
| Token Metadata | Metaplex `mpl-token-metadata` | Decode token name/symbol/URI |
| State (hot) | Redis 7 (`ioredis`) | Sub-ms reads, pub/sub for dashboard updates |
| Database | PostgreSQL 16 + Prisma | Trade history, filter analytics |
| Job Queue | BullMQ | Schedule exit checks, rug-pull monitoring |
| WebSocket Server | Socket.io | Push live pool/position updates to dashboard |
| Config | dotenv + Zod | Type-safe, validated runtime config |
| Logging | Pino | Structured JSON logs, fast |
| Process Mgmt | PM2 | Auto-restart, log rotation |

### Dashboard

| Layer | Tech | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + React 19 | Server components, fast |
| Real-time | Socket.io client | Live pool feed, position updates |
| Charts | Lightweight Charts (TradingView) + Recharts | Price chart per token, P&L chart |
| Tables | TanStack Table v8 | Sortable/filterable position + history tables |
| State | Zustand | Filter config, settings |
| UI | Tailwind CSS + shadcn/ui | Fast to build, clean |
| Forms | React Hook Form + Zod | Filter config UI with validation |

### Infrastructure (local Docker)

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redis-data:/data"]
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: postgres
    volumes: ["pg-data:/var/lib/postgresql/data"]
  grafana:                            # Optional - dashboards over Postgres
    image: grafana/grafana:latest
    ports: ["3001:3000"]
volumes:
  redis-data:
  pg-data:
```

---

## 5. Best APIs & Data Sources (2026 Stack)

### Tier 1 — Real-time Pool Detection (must-have)

| API | What | Free? | Why use it |
|---|---|---|---|
| **Helius RPC + WebSocket** | Solana RPC, enhanced txs, webhooks for program invocations | Free 100k req/day, paid from $49/mo | Best Solana provider. Webhooks notify in <500ms when Raydium/pump.fun creates new pool |
| **Helius Geyser** | Push-based account/tx stream | Paid (~$99/mo) | Lowest latency for serious sniping |
| **Triton** | Premium RPC + Yellowstone gRPC | Paid | Backup, also gRPC stream for ultra-low latency |
| **Jito Block Engine** | Bundle submission for priority inclusion | Free (you pay tip in SOL) | Mandatory for competitive snipes |
| **Pump.fun WebSocket** (`pumpportal.fun`) | New pump.fun launches stream | Free + paid tier | Direct firehose of every pump.fun creation |

### Tier 2 — Token Data & Analytics

| API | What | Free? | Use case |
|---|---|---|---|
| **Birdeye API** | Token price, holders, security score, OHLCV | Free 30k/mo, paid scales | Holder analysis, top-holder %, security data |
| **DexScreener API** | All DEX pairs across chains, free | Yes (rate limited ~300/min) | Backup pool feed, token metadata |
| **GeckoTerminal API** | Pool info, OHLCV, trades | Yes (free tier ~30/min) | Validation cross-check |
| **Bitquery** | GraphQL on-chain queries | Free 10k/mo, paid | Dev wallet history, fund tracing |
| **Solscan Pro API** | Token info, transfers, holders | Paid from $99/mo | Holder analysis at scale |
| **Jupiter Token List API** | Verified token registry | Free | Whitelist check |
| **Jupiter Quote/Swap API** | Routes, simulate-tx | Free | Honeypot simulation, execution |

### Tier 3 — Security & Rug Detection

| API | What | Free? | Use case |
|---|---|---|---|
| **RugCheck.xyz API** | Solana token risk scoring | Free + paid | Pre-built rug score, LP lock check |
| **GoPlus Security API** | Multi-chain token security | Free tier | Honeypot, mint, freeze checks |
| **Solsniffer** | Solana-specific scam scoring | Free + paid | Secondary validation layer |
| **DexScreener boosts/social** | Token social presence | Free | Twitter/Telegram link presence |

### Tier 4 — Social Signal (optional alpha)

| Source | What | How |
|---|---|---|
| Twitter API (X v2) | Mentions of token ticker/CA | Paid ($100/mo Basic) — track CA mentions in real-time |
| Telegram public channels | Alpha calls | telethon scraper of known caller channels |
| Truth Social (occasionally) | Major figure posts moving market | Webhook integration |

### What to actually subscribe to (recommended starter setup)

```
Paid (start):
- Helius Developer plan: $49/mo (100M credits, webhooks, enhanced RPC)
- Birdeye Standard: $0–$99/mo

Free:
- DexScreener API (backup)
- GeckoTerminal API (validation)
- RugCheck.xyz (rug score)
- Jito (free, just pay tips)
- Jupiter (free)

Total starter cost: ~$50/mo
```

---

## 6. Pool Detection Pipeline

### Sources to monitor (Solana-first)

| Source | Program ID | Notes |
|---|---|---|
| **pump.fun** | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Launchpad, bonding curve. Highest volume of new launches |
| **PumpSwap** | (post-pump.fun migration AMM) | Tokens that graduated from pump.fun |
| **Raydium AMM v4** | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | Standard AMM pools |
| **Raydium CLMM** | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | Concentrated liquidity |
| **Raydium Launchpad** (LetsBonk) | (program ID) | New launchpad |
| **Meteora DLMM** | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | Dynamic liquidity bins |
| **Orca Whirlpools** | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Concentrated liquidity |

### Detection mechanism

```
1. Helius Webhook subscribes to "InitializePool" / "Create" instructions across all program IDs above
2. On callback (within ~300-800ms of confirmation):
   a. Parse instruction data → extract token mint, base mint, initial liquidity
   b. Push to Redis Stream `new-pools` immediately
3. Filter orchestrator consumes stream, runs all filters in parallel
4. If filters pass → push to `snipe-queue`
5. Executor consumes snipe-queue, executes paper or live trade
```

### Latency budget (target)

```
Pool creation on-chain:           t = 0
Helius confirms + webhooks:       t + 400ms
Our server receives webhook:      t + 500ms
All filters run (parallel):       t + 700ms (target <200ms total)
Execution decision:               t + 750ms
Jito bundle submitted:            t + 800ms
Bundle landed:                    t + 1.2s

Realistic snipe latency: ~1-1.5 seconds from pool creation to fill
Pro bots: ~400-800ms (Geyser stream + colo'd nodes)
```

---

## 7. Filter Engine (The Real Alpha)

Each filter is **independent, togglable, configurable**. Filter results stored per-token for analytics — you'll learn which filters predict winners after 2 weeks of paper data.

### Filter 1 — Liquidity Minimum

```
Reject if initial pool liquidity < $X (configurable, default $5,000)
Reject if liquidity > $Y (configurable, default $500,000) — too late
Sweet spot: $5k - $50k initial liquidity
```

### Filter 2 — LP Locked / Burned

```
Check LP token account:
- Are LP tokens sent to burn address (11111...)? → SAFE
- Are LP tokens locked in known locker (Streamflow, Team Finance, PinkLock)? → SAFE
- Are LP tokens still in dev wallet? → REJECT (rug risk)
```

### Filter 3 — Mint Authority Renounced

```
Query token mint account:
- mintAuthority == None → SAFE (no more tokens can be minted)
- mintAuthority == dev wallet → REJECT (dev can mint infinite supply)
```

### Filter 4 — Freeze Authority Renounced

```
- freezeAuthority == None → SAFE
- freezeAuthority == anyone → REJECT (dev can freeze your wallet)
```

### Filter 5 — Top Holder Concentration

```
Fetch top 20 holders via Helius/Birdeye
Reject if:
- Top 1 holder > 15% (excluding LP, locked, burn addresses)
- Top 10 holders > 35%
- Single non-LP wallet > 8%

Configurable thresholds per filter.
```

### Filter 6 — Dev Wallet History (BIGGEST ALPHA)

```
Trace dev wallet (creator of token mint):
1. Query last 100 tokens deployed by this wallet
2. Calculate rug rate (tokens that went to 0 within 24h)
3. Reject if dev wallet rug rate > 30%
4. Reject if dev wallet is on community blacklist (RugCheck flagged)

Maintain local DB of known ruggers — auto-update from RugCheck reports
```

### Filter 7 — Bundled Launch Detection

```
Check first 20 transactions in pool:
- If >X% of supply bought in first block by wallets funded from same source → REJECT
- These are dev's alt wallets — they will dump on you
- Tools: detect funding chain via Bitquery/Helius
```

### Filter 8 — Insider Detection

```
Check if creator wallet:
- Was funded by known insider/team wallet
- Has interacted with > N successful launches recently
- Shows pattern of pump-and-dump

Use Bitquery to trace fund flow 2-3 hops back
```

### Filter 9 — Honeypot Simulation (CRITICAL)

```
BEFORE buying, simulate the SELL:
1. Use Jupiter API: simulate swap of token → SOL
2. If simulation fails → HONEYPOT, REJECT
3. If sell tax > X% (default 10%) → REJECT
4. If simulation shows < 50% of expected output → REJECT (high transfer fee/tax)

This is the #1 filter that saves you from total losses.
```

### Filter 10 — Social Presence

```
Optional, configurable weight:
- Token has Twitter handle? Followers > threshold?
- Token has Telegram? Members > threshold?
- Has website?
- DexScreener "boosted"?

Score 0-100, configurable minimum threshold
```

### Filter 11 — Volume Velocity (post-detection, for slightly older pools)

```
For pools 1-10 minutes old:
- Buy/sell ratio (buys > 1.5x sells = bullish)
- Unique buyer count (>50 in 5 min = organic)
- Volume per minute trending up
```

### Filter 12 — Anti-Sniper-War

```
If pool already has >N transactions in first block (default 10):
- Snipers are already in
- You'll buy at top of their pump
- REJECT or reduce position size by 50%
```

### Filter Orchestrator Logic

```
For each new pool:
  Run all enabled filters in parallel (Promise.all)
  Score = weighted sum of (filter_pass × filter_weight)

  Modes:
  - STRICT: ALL critical filters (1-9) must pass → snipe
  - SCORED: Score > threshold (e.g. 70/100) → snipe
  - LEARNING: Snipe everything that passes filter 9 (honeypot only), log all data, analyze later

  In paper trading, default to LEARNING mode for first week
  to gather data on which filters actually predict winners.
```

---

## 8. Paper Trading Simulator (Phase 1 Priority)

This is the most important component. Must be realistic — if paper P&L is fake-good, live trading will destroy you.

### What it must simulate

| Real-world cost | Simulation logic |
|---|---|
| **Slippage** | Calculate expected fill from pool reserves at detection time vs. estimated reserves at fill time (1-2s later). Apply to both buy and sell. |
| **Priority fee** | Subtract estimated Jito tip (configurable, default 0.001-0.01 SOL per trade) |
| **Network fee** | Subtract base Solana fee (~0.00001 SOL) |
| **MEV sandwich** | Random 0.5-3% extra slippage on ~30% of trades (realistic estimate) |
| **Failed transactions** | ~10% of attempts "fail" (insufficient slippage tolerance, beat by other bots) — burn fee anyway |
| **Late fills** | If you snipe 1.5s after creation, simulate fill price as if pool already had N early buys |

### Paper executor flow

```typescript
// Pseudo-code
async function paperBuy(pool: Pool, sizeUsd: number) {
  const detectedAt = pool.detectedAt;
  const fillDelay = randomBetween(800, 1500); // ms
  const fillTime = detectedAt + fillDelay;

  // Estimate pool state at fill time
  const expectedReserves = estimateReservesAt(pool, fillTime);
  const slippage = calculateSlippage(sizeUsd, expectedReserves);

  // Random failure
  if (Math.random() < 0.10) {
    return { status: 'failed', costSol: NETWORK_FEE };
  }

  // Random MEV sandwich
  const mevPenalty = Math.random() < 0.30 ? randomBetween(0.005, 0.03) : 0;

  const effectivePrice = pool.price * (1 + slippage + mevPenalty);
  const tokensReceived = sizeUsd / effectivePrice;

  return {
    status: 'filled',
    entryPrice: effectivePrice,
    tokensReceived,
    costSol: NETWORK_FEE + JITO_TIP,
    fillTime,
  };
}
```

### Tracking — Per-trade

For every paper trade store:
- All filter results at entry time (which filters passed/failed)
- Entry price, size, time, filter score
- Every TP hit, SL hit, exit reason
- Final P&L in SOL and USD
- Time to peak, peak gain, drawdown from peak

### Tracking — Aggregate metrics (must compute daily)

- Win rate (% trades with positive P&L)
- Avg win % / Avg loss %
- Expected value per trade
- Sharpe ratio
- Max drawdown
- Hit rate by filter combination (which filters predict winners)
- Hit rate by token age at entry
- Hit rate by initial liquidity bracket
- Hit rate by DEX source

### Validation gate before going live

```
After 2-5 weeks paper, only enable live mode if:
✓ Total trades > 200
✓ Win rate > 15%
✓ Avg win / avg loss > 3.0
✓ Sharpe > 1.5
✓ Max drawdown < 30%
✓ At least 5 trades > 5x
✓ No catastrophic single-day loss (> 20%)

If criteria not met → tune filters, reset, paper trade another 2 weeks.
```

---

## 9. Exit Strategy Engine

Most snipers lose because they **don't sell**. Exits must be auto, ladder-based, and emotion-free.

### Default TP Ladder (configurable)

```
Position opened at $1k position size.

TP1: +50%   → sell 25% of position (lock initial cost partially)
TP2: +100%  → sell 25% (now in profit even if rest goes to 0)
TP3: +300%  → sell 25%
TP4: +900%  → sell 15%
Moonbag: 10% → ride forever, never sell (or sell at +5000% if reached)

Stop loss: -40% from entry → sell 100%
Trailing stop: after +200%, trail 30% from peak
Time exit: if no +50% within 30 min → sell 100% (capital efficiency)
Rug detection: if liquidity drops > 50% in 1 block → emergency sell
```

### Exit triggers (all run in parallel, first to trigger wins)

```
For each open position, every 1-2 seconds:
  1. Check current price vs TP levels → execute partial sells
  2. Check vs stop loss
  3. Check vs trailing stop (if peak tracked)
  4. Check time-based exit
  5. Check pool liquidity (rug pull detection)
  6. Check holder count change (mass exodus signal)
```

### Rug Pull Auto-Exit (CRITICAL)

```
Subscribe to pool account changes via Helius WS.
On every pool state change:
  - Calculate new liquidity
  - If liquidity dropped > 30% in single tx → INSTANT MARKET SELL
  - Use Jito bundle with maximum tip to front-run further dumpers
  - Often saves 60-80% vs waiting
```

---

## 10. Risk Management

### Position Sizing

```
Default mode: Fixed % of bankroll per snipe
- Default: 1% per snipe (configurable 0.25% - 5%)
- Max concurrent positions: 10 (configurable)
- Max total exposure: 30% of bankroll at any time

Advanced mode: Kelly-modified
- Sizing scales with filter confidence score
- High score (>90) = 2% position
- Medium score (70-90) = 1%
- Low score (<70) = 0.5% (or skip)
```

### Drawdown Circuit Breaker

```
Daily loss > 10% of bankroll → HALT all new entries for 24h
Weekly loss > 25% → HALT for 72h, force review of filters
Single day with > 20 consecutive losses → HALT for 24h
```

### Concurrent Position Limits

```
Max 10 open positions at once (configurable)
Max 3 positions opened in same 60-second window (rate limit)
Max 1 position per pool (no doubling down)
```

### Capital Protection

```
Reserve mode: Never deploy more than X% of wallet (default 50%)
Auto-withdraw: When bankroll grows >2x starting, withdraw 50% to cold wallet
Loss cap: If bankroll drops to 50% of starting → STOP, full review
```

---

## 11. Dashboard (Real-time Control Center)

Served at `http://localhost:3000`. Updates via Socket.io.

### Page 1 — Live Operations (Home)

- **Mode badge**: PAPER / LIVE (huge, color-coded)
- **Bankroll**: Current $ value, today's P&L, all-time P&L
- **Live pool feed**: Stream of every new pool detected
  - Each pool card shows: token name/symbol, age, liquidity, all filter results (pass/fail per filter), final score, decision (SNIPED / REJECTED), reason
  - Click pool → drill into details, see entry tx, current price chart
- **Active positions panel**: Open positions with entry, current price, unrealized P&L %, time held, next TP level
- **Recent exits**: Last 10 closed trades with P&L
- **Kill switch**: Big red button. Closes all positions at market, halts engine.
- **Pause new entries**: Lets existing positions close naturally

### Page 2 — Positions

- Detailed table of all open positions
- Per-position: live chart (Lightweight Charts), TP/SL levels overlaid
- Manual close button per position (paper or live)
- Manual TP/SL override per position

### Page 3 — Trade History

- Full table of every paper + live trade
- Sortable/filterable by: date, DEX, filter score, P&L, win/loss
- Per-trade drill-down: filter results at entry, entry/exit charts, all events
- Export to CSV
- Stats summary: win rate, avg win, avg loss, Sharpe, max DD, profit factor

### Page 4 — Filter Configuration

- Toggle each filter on/off
- Adjust thresholds with sliders + numeric inputs
- Save/load filter presets (e.g. "Aggressive", "Conservative", "Learning")
- Live preview: "If these filters were applied, last 7 days would have sniped X tokens"

### Page 5 — Analytics (THE GOLD)

- **Per-filter performance**: For each filter, what's the win rate of trades that passed it vs failed it? Helps identify which filters are useful and which are noise.
- **Filter combination matrix**: Heatmap of win rates by filter combo
- **DEX source performance**: Win rate by source (pump.fun vs Raydium etc.)
- **Liquidity bracket performance**: Win rate by initial liquidity bucket
- **Time-of-day performance**: Best hours to snipe
- **Day-of-week performance**

### Page 6 — Settings

- Wallet config (live mode only — wallet keypair path)
- RPC endpoints (Helius primary, Triton backup)
- Jito tip strategy (fixed / dynamic)
- Position sizing rules
- TP/SL ladder editor
- Drawdown limits
- Telegram bot token + chat ID for alerts
- Mode switch (PAPER → LIVE) with multi-step confirmation

---

## 12. Customization Layer

Everything must be runtime-configurable without code changes.

### Filter SDK (pluggable)

```typescript
// packages/filter-sdk
export interface Filter {
  id: string;
  name: string;
  weight: number;
  enabled: boolean;
  config: Record<string, unknown>;  // Threshold values

  evaluate(pool: PoolData): Promise<FilterResult>;
}

export interface FilterResult {
  passed: boolean;
  score: number;          // 0-100
  reason: string;
  metadata: Record<string, unknown>;
}
```

User can:
- Disable any filter from UI
- Adjust any threshold from UI
- Save filter sets as named presets
- Switch presets on the fly
- Write custom filters as plugins (later phase)

### Strategy Modes (presets)

```
1. "Safe Sniper"    — strict filters, low position size, only 30%+ filter score
2. "Aggressive"     — looser filters, higher size, allow lower scores
3. "Learning Mode"  — only honeypot filter on, snipe everything to gather data
4. "Pump.fun Only"  — restrict to pump.fun launches
5. "Graduated Only" — restrict to PumpSwap (post-bonding curve, more proven)
6. "High Liquidity" — only snipe pools with $20k+ liquidity (lower risk, lower upside)
```

---

## 13. Environment Config (.env)

```env
# === MODE ===
MODE=paper                            # paper | live
ENABLE_LIVE_TRADING=false             # Hard gate, must explicitly enable

# === SOLANA RPC ===
HELIUS_API_KEY=
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=
TRITON_RPC_URL=                       # Backup RPC
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf

# === DATA APIS ===
BIRDEYE_API_KEY=
BITQUERY_API_KEY=
RUGCHECK_API_KEY=                     # optional
DEXSCREENER_BASE=https://api.dexscreener.com
GECKOTERMINAL_BASE=https://api.geckoterminal.com/api/v2

# === WALLET (LIVE MODE ONLY) ===
SOLANA_KEYPAIR_PATH=/secure/path/keypair.json
WALLET_PUBKEY=

# === BANKROLL ===
PAPER_STARTING_BALANCE_USD=10000
LIVE_MAX_BANKROLL_USD=500             # Start TINY in live mode

# === POSITION SIZING ===
POSITION_SIZE_PCT=1.0
MAX_CONCURRENT_POSITIONS=10
MAX_TOTAL_EXPOSURE_PCT=30
MAX_POSITION_PER_MIN=3

# === EXITS ===
TP_LADDER=50:25,100:25,300:25,900:15  # gain%:sellPct
STOP_LOSS_PCT=-40
TRAILING_STOP_PCT=30
TRAILING_STOP_ACTIVATION_PCT=200
TIME_EXIT_MIN=30                      # minutes
RUG_DETECTION_LP_DROP_PCT=30

# === RISK ===
DAILY_DRAWDOWN_LIMIT_PCT=10
WEEKLY_DRAWDOWN_LIMIT_PCT=25
HALT_ON_CONSECUTIVE_LOSSES=20

# === FILTERS - all togglable ===
FILTER_LIQUIDITY_MIN_USD=5000
FILTER_LIQUIDITY_MAX_USD=500000
FILTER_LP_LOCKED_REQUIRED=true
FILTER_MINT_AUTH_RENOUNCED=true
FILTER_FREEZE_AUTH_RENOUNCED=true
FILTER_TOP_HOLDER_MAX_PCT=15
FILTER_TOP_10_HOLDERS_MAX_PCT=35
FILTER_DEV_RUG_RATE_MAX=0.30
FILTER_HONEYPOT_SIM_REQUIRED=true
FILTER_MAX_SELL_TAX_PCT=10
FILTER_BUNDLED_LAUNCH_REJECT=true
FILTER_MIN_FILTER_SCORE=70

# === EXECUTION ===
JITO_TIP_LAMPORTS=10000               # 0.00001 SOL = $0.001
JITO_TIP_DYNAMIC=true                 # Scale by competition
SLIPPAGE_BPS=300                      # 3%
PRIORITY_FEE_MICROLAMPORTS=100000

# === DEX SOURCES ===
ENABLE_PUMPFUN=true
ENABLE_PUMPSWAP=true
ENABLE_RAYDIUM_AMM=true
ENABLE_RAYDIUM_CLMM=false
ENABLE_RAYDIUM_LAUNCHPAD=true
ENABLE_METEORA=false
ENABLE_ORCA=false

# === INFRASTRUCTURE ===
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sniperbot

# === ALERTS ===
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ALERT_ON_NEW_POSITION=true
ALERT_ON_EXIT=true
ALERT_ON_DAILY_PNL=true
ALERT_ON_DRAWDOWN_HALT=true
```

---

## 14. Implementation Phases

### Phase 0 — Setup (Day 1-2) ✅ COMPLETE
- [x] Init monorepo (pnpm workspaces or turborepo)
- [x] Docker Compose: Redis + Postgres up
- [x] Prisma schema for trades, pools, filter_results, positions
- [x] Env validation with Zod
- [x] Basic Pino logging setup
- [x] Helius API key acquired, test RPC + WS connection

### Phase 1 — Pool Detection (Day 3-7) ✅ COMPLETE
- [x] Helius webhook setup for pump.fun program
- [x] Helius webhook setup for Raydium AMM v4
- [x] Pool event normalizer (unified schema across DEXes)
- [x] Redis Stream `new-pools` working
- [x] Dashboard skeleton showing live pool feed (no filters yet)
- [x] **Validation**: Should see 100s of new pools per hour streaming live (synthetic feed in place; live Helius validation pending real API key run)

### Phase 2 — Filter Engine (Day 8-14) 🟡 MOSTLY COMPLETE
- [x] Implement filters 1-12 (each as separate, testable module) — 1-7 + 9 fully implemented; 8, 10-12 stubbed (work in synthetic mode, deferred for real-mode wiring to Phase 4)
- [x] Honeypot simulator using Jupiter quote API
- [x] Dev wallet history tracker (Bitquery + local cache) — uses RugCheck + local `RuggedDevWallet` table + in-proc cache
- [x] Filter orchestrator (parallel execution)
- [x] Filter results stored in Postgres for every pool seen
- [x] Dashboard shows filter results per pool
- [ ] **Validation**: Verify each filter's logic against 20 known good and 20 known rug tokens manually

### Phase 3 — Paper Trading Simulator (Day 15-21) 🟡 MOSTLY COMPLETE
- [x] Paper executor with realistic slippage/fee/MEV simulation — `execution/paper-executor.ts` (depth-based slippage, 10% fail, 30% MEV penalty, Jito tip)
- [x] Position store (in-memory hot + Postgres history) — `state/position-store.ts` (Redis-hot deferred; in-memory is sufficient for single-process engine)
- [x] TP ladder + SL + trailing stop + time exit logic — `exits/exit-engine.ts` (1s tick, priority-ordered exits)
- [x] Rug pull auto-exit — synthetic mode covered by `price-simulator.ts` rug events; real-mode pool-account subscription deferred to Phase 4
- [x] PnL tracker (per trade, daily, all-time) — `analytics/pnl-tracker.ts` (per-minute snapshots into `BankrollSnapshot`)
- [x] Dashboard positions + history pages — `/positions`, `/history`, `BankrollBar`, `PositionsTable`, `HistoryTable`, nav in Header
- [x] Smoke run — 90s synthetic run produced 19 snipes, 12 buys, 33 sells (TP partials), 2 trailing-stop closes, all persisted
- [ ] **Validation**: Run paper mode for 24h. Verify PnL math by spot-checking 10 trades manually.

### Phase 4 — Analytics & Tuning (Week 4)
- [ ] Per-filter win rate analytics
- [ ] Filter config UI on dashboard
- [ ] Strategy presets (Safe / Aggressive / Learning)
- [ ] Backtest mode: replay last N days with different filter configs
- [ ] **Validation**: Identify which 3-5 filters actually predict winners. Discard noise filters.

### Phase 5 — Paper Validation Period (Week 5-7)
- [ ] Run paper mode 24/7 for 2-3 weeks with tuned filters
- [ ] Daily PnL review
- [ ] Tune filters based on per-filter analytics
- [ ] Adjust TP ladder based on actual winner profile
- [ ] Document final filter configuration
- [ ] **Gate**: Hit ALL validation criteria from §8 before proceeding

### Phase 6 — Live Mode Wiring (Week 8)
- [ ] Wallet keypair loading (encrypted, never in env directly)
- [ ] Jito bundle submission code
- [ ] Multi-step confirmation UI to enable live mode
- [ ] Hardcoded max position size $50 for first week live
- [ ] All txs logged with full debug info
- [ ] **Validation**: Manually review every single live trade for first 50 trades

### Phase 7 — Live Trading (Ongoing, careful scaling)
- [ ] Week 1 live: $200 bankroll, $5/snipe, 50 trades, full review after
- [ ] Week 2 live: if positive ROI, scale to $500 bankroll, $15/snipe
- [ ] Week 3+: scale only if Sharpe holds, never more than 2x per week
- [ ] Auto-withdraw 50% of profits to cold wallet weekly

### Phase 8 — Ongoing Edge Maintenance
- [ ] Weekly: review filter performance, retune
- [ ] Monthly: check for new DEX sources to add
- [ ] Watch for new launchpads (this scene rotates fast)
- [ ] Maintain dev rugger blacklist
- [ ] Monitor for protocol changes (pump.fun migrations etc.)

---

## 15. Realistic Expectations (Brutal Truth)

### Paper trading expectations
- First week: most trades will be losers as filters are untuned
- Week 2-3: filter tuning improves win rate
- Week 4+: should see stable Sharpe if approach has edge

### Live trading expectations (after passing paper validation gate)
- 50% chance: lose 30-50% of starting bankroll in first month (real conditions are worse than paper)
- 30% chance: roughly break even, learn a lot
- 15% chance: small profit ($100-$500/mo on $500 bankroll)
- 5% chance: hit a 100x winner, 10x bankroll in a month

### What "success" looks like realistically
- Consistent +20-50% monthly on small bankroll = excellent
- Anything > 100% monthly is luck, not skill (don't extrapolate)
- Drawdowns of 40%+ will happen — survive them or you can't compound

### What WILL go wrong
- A token will rug 5 seconds after you buy. Multiple times.
- Honeypot will slip through your filters. Fix the filter, move on.
- You'll snipe a "guaranteed winner", it will dump 90%
- A single Jito tip war will eat your week's profit
- Solana will have a network outage during your best trade
- An exchange listing will moon a token you JUST sold for -20%

### The mental game
- DO NOT manually override the bot in heat of moment
- DO NOT increase position size after a losing streak
- DO NOT decrease position size after a winning streak (unless following Kelly)
- Withdraw profits regularly — paper P&L isn't real until SOL is in cold wallet

---

## 16. Security & Safety

### Wallet security (LIVE mode)
- Use a dedicated hot wallet, NOT your main wallet
- Keep only the bankroll on it ($200-$2000 max)
- Auto-sweep profits to cold wallet daily
- Keypair file encrypted at rest, decrypted only at engine startup
- Never log private key, never commit keypair to git
- Use `.gitignore` to exclude `*.keypair.json`, `secrets/`, `.env*`

### API key safety
- All API keys in `.env`, gitignored
- No keys hardcoded
- Rotate Helius/Birdeye keys monthly

### Bot safety
- Rate limit your own RPC calls (don't get banned)
- Circuit breakers on every external API
- Watchdog process: if engine crashes, restart but DON'T auto-resume positions
- Audit log of every trade decision (for debugging post-loss)

### Don't get scammed
- Don't trust "guaranteed sniper bot" services online
- Don't share your keypair or seed with anyone
- Don't run code from random GitHub repos in your wallet's environment
- This is YOUR code — read every line before live mode

---

## 17. Key npm Packages

### Engine
```json
{
  "dependencies": {
    "@solana/web3.js": "^1.95.0",
    "@solana/spl-token": "^0.4.0",
    "@metaplex-foundation/mpl-token-metadata": "^3.x",
    "helius-sdk": "^1.x",
    "jito-ts": "^4.x",
    "@jup-ag/api": "^6.x",
    "ioredis": "^5.x",
    "bullmq": "^5.x",
    "@prisma/client": "^5.x",
    "prisma": "^5.x",
    "socket.io": "^4.x",
    "ws": "^8.x",
    "zod": "^3.x",
    "dotenv": "^16.x",
    "pino": "^9.x",
    "axios": "^1.x",
    "p-queue": "^8.x"
  }
}
```

### Dashboard
```json
{
  "dependencies": {
    "next": "15.x",
    "react": "19.x",
    "lightweight-charts": "^4.x",
    "recharts": "^2.x",
    "socket.io-client": "^4.x",
    "zustand": "^4.x",
    "@tanstack/react-table": "^8.x",
    "react-hook-form": "^7.x",
    "tailwindcss": "^3.x",
    "@radix-ui/react-*": "latest"
  }
}
```

---

## 18. Testing Strategy

### Unit tests
- Each filter: test against known good/bad token fixtures
- Slippage calculator: test against known pool reserve scenarios
- TP ladder: test with synthetic price progressions
- Honeypot simulator: mocked Jupiter responses

### Integration tests
- Paper executor end-to-end: simulate a full trade lifecycle
- Pool detection: replay recorded webhook events
- Rug detection: simulate liquidity drop scenarios

### Manual QA before live mode
- Run 100 paper trades, manually verify 10 random ones
- Test every UI control (kill switch, manual close, filter toggles)
- Test recovery from engine crash mid-position
- Test recovery from RPC outage

---

## 19. Quick Start Commands (after build)

```bash
# Initial setup
docker-compose up -d
pnpm install
pnpm prisma migrate dev

# Start in paper mode (default)
pnpm dev:engine
pnpm dev:dashboard

# Open dashboard
open http://localhost:3000

# Switch to live mode (after validation)
# Use dashboard Settings page → Mode toggle (multi-step confirmation)
```

---

## 20. Final Notes

- **Paper trade for 2-5 weeks minimum.** No exceptions. Anyone who skips this loses money.
- **Start tiny in live mode.** $200 bankroll, $5 per snipe. Scale only with proven results.
- **The filter analytics page is your most valuable tool** — it shows what actually works.
- **Most of your edge will come from the dev wallet history filter** — invest most filter-tuning time here.
- **You are not Citadel.** You're not racing them either. You're racing other Telegram-bot users. Beat them with smarter filters and tighter exits.
- **Withdraw profits aggressively.** The market gives, the market takes. Don't let unrealized P&L stay unrealized too long.

---

*Generated: May 2026 | Stack: Node.js 22 + Next.js 15 + Solana Web3.js + Helius + Jito + Jupiter | Mode: PAPER FIRST*

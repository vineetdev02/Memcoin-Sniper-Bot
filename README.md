# Memecoin Sniper Bot

A Solana memecoin sniper built **filter-first**. It watches new pools appear on pump.fun,
PumpSwap and Raydium, runs every launch through twelve rug and honeypot checks, paper-trades the
survivors with disciplined exits, and shows all of it on a live dashboard. It can also send
alerts to your phone through Telegram.

> **Paper mode is the default, and the only mode that trades.** No wallet, no keys, no real
> funds. A live executor has not been built yet (see [Status](#status)). None of this is
> financial advice. Most new memecoins go to zero within a day, and this project is built around
> that assumption.

---

## Why filter-first

Thousands of bots compete on speed, and most launches are rugs by repeat offenders. A bot that
buys faster than everyone else mostly just loses money faster. The edge is in **what you refuse to
buy** and **when you sell**:

- A honeypot lets you buy but not sell, so the sell is simulated *before* the buy.
- A dev whose last twenty tokens went to zero will probably make it twenty-one, so dev history
  is checked on every launch.
- A win rate of 5–20% is normal, so position sizing assumes long losing streaks and the drawdown
  circuit enforces that.

## How it works

```
 Helius logs (WebSocket)            ┌─────────────────────────────┐
 pump.fun · PumpSwap · Raydium ───▶ │ Pool detector               │  normalise every DEX to one PoolEvent
                                    └──────────────┬──────────────┘
                                                   ▼
                                                   │ waits EVAL_DELAY_SEC (90s)
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │ Filter orchestrator         │  12 filters in parallel, weighted score
                                    │  any hard fail  → reject    │
                                    │  score < min    → reject    │
                                    └──────────────┬──────────────┘
                                                   ▼ snipe
                                    ┌─────────────────────────────┐
                                    │ Trader (paper)              │  buys at the Jupiter market price
                                    │  ◀── drawdown circuit gate  │  size · concurrency · exposure · rate limits
                                    └──────────────┬──────────────┘
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │ Exit engine + rug watcher   │  TP ladder · stop-loss · trailing · time · rug
                                    └──────────────┬──────────────┘
                                                   ▼
                 Postgres (history) · Redis (streams) · Socket.IO ─▶ Dashboard · Telegram
```

### The twelve filters

| Filter | Rejects when | Weight |
| --- | --- | --- |
| `honeypot-sim` | a 0.01 SOL buy-and-sell round trip through Jupiter cannot sell, or costs more than the max sell tax (a pump.fun curve passes: its program executes every sell) | 15 |
| `dev-wallet` | the creator is a known rugger or has a high rug rate | 12 |
| `mint-authority` | the dev can still mint more supply | 10 |
| `freeze-authority` | the dev can still freeze holders' tokens | 10 |
| `lp-locked` | liquidity is neither burned nor locked | 10 |
| `top-holders` | the largest holder, or the top ten together, hold too much | 8 |
| `bundled-launch` | the first block was bought by wallets funded from one source | 8 |
| `insider-detection` | the creator was funded by a flagged wallet | 6 |
| `liquidity-min` | liquidity is too thin to exit, or too deep to still be early | 5 |
| `volume-velocity` | buy/sell flow and unique buyers look inorganic | 4 |
| `anti-sniper-war` | the first block was already crowded with snipers | 4 |
| `social-signal` | its DexScreener profile shows too little social presence (no profile at all is unknown: profiles are paid) | 3 |

Every filter can be toggled and tuned from the dashboard, and settings can be saved as presets
(**Safe**, **Aggressive** and **Learning** ship built in). Every verdict is stored, so the
analytics page can show which filters actually predict winners.

### Exits and risk

- **Take-profit ladder**: by default it sells 25% at +50%, 25% at +100%, 25% at +300% and 15% at
  +900% (`TP_LADDER`).
- **Stop-loss** at -40%, a **trailing stop** that arms after +200%, and a **time exit** for
  positions that never move.
- **Real prices**: a paper trade on a real pool enters at what a real buy of that size would pay
  (Jupiter's executable quote), and only when Jupiter's price index agrees within -20%/+25% — an
  index 114× too high once cost a whole position. It is then marked and sold at the index,
  polled every 3 seconds; a move of 3× or more in one poll is held until the next poll confirms
  it, so one bad tick cannot fire a take-profit or a stop. Only synthetic-feed pools use the
  price simulator.
- **Rug watcher**: reads each open position's liquidity from the same feed and force-sells when it
  drops sharply (`RUG_DETECTION_LP_DROP_PCT`).
- **Evaluation delay**: a new pool is judged `EVAL_DELAY_SEC` (default 90) after it appears. At
  launch the honeypot quote, trading volume and socials do not exist yet, so several filters
  could only answer "unknown".
- **Restarts**: positions left open by the last run are restored and keep their exits, and the
  bankroll carries over everything already closed.
- **Position limits**: 1% of bankroll per trade, at most 10 open positions, a 30% total exposure
  cap, and a limit on entries per minute.
- **Drawdown circuit**: halts new entries for 24 hours after a 10% daily loss or 20 losses in a
  row, and for 72 hours after a 25% weekly loss. Exits keep running during a halt.

The paper executor models slippage from pool depth, failed fills, MEV sandwich losses and Jito
tips, so paper results are not flattering fiction.

---

## Quick start

**Requirements:** Node.js 22 or newer, pnpm 10, and Docker.

```bash
git clone https://github.com/vineetdev02/Memcoin-Sniper-Bot.git
cd Memcoin-Sniper-Bot
pnpm install

cp .env.example .env               # every setting has a working default
ln -s ../../.env apps/engine/.env  # the engine and Prisma read .env from their own folder

pnpm docker:up                     # Redis on :6380, Postgres on :5433
pnpm prisma:migrate                # create the tables
```

**No Helius key yet?** Set `SYNTHETIC_FEED=true` in `.env`. The engine then generates realistic
fake launches, rugs included, so the whole pipeline runs without any API key.

**With a Helius key** (a free one is enough to start), put it in `HELIUS_API_KEY`.

Then run the engine and the dashboard in two terminals:

```bash
pnpm dev:engine       # the bot itself
pnpm dev:dashboard    # http://localhost:3000
```

**The bot starts off.** Until you press **Bot OFF → ON** in the dashboard header, the engine does
not even connect to the RPC provider: no pools are detected, filtered or traded, and no Helius
credits are spent. Every restart turns it off again. Pressing it off unsubscribes and stops new
entries; open positions keep their take-profits, stop-losses and rug watch, none of which use RPC.
The **RPC** counter next to the button is every request the engine has sent since it started —
roughly the credits spent. The Backtest page is the one other thing that spends them: each replayed
pool runs the preset's filters against the RPC, even while the bot is off.

| Page | What it shows |
| --- | --- |
| **Live** | new pools as they are detected, with a pass/fail pill per filter |
| **Positions** | open paper positions, live P&L, TP ladder progress |
| **History** | every closed trade and why it closed |
| **Analytics** | win rate, profit factor, per-filter lift, results by DEX, liquidity and hour |
| **Filters** | toggle and tune filters, save and activate presets |
| **Backtest** | replay stored pools through any preset without touching live trading |

---

## Telegram alerts

The bot can message you whenever it buys, sells, detects a rug or halts trading, and send a daily
P&L report. It is off until you give it a bot token and a chat id.

**Setup (about two minutes):**

1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token into `.env`:
   `TELEGRAM_BOT_TOKEN=...`
2. Open a chat with your new bot and press **Start**. To use a group instead, add the bot to the
   group and send it a message.
3. Leave `TELEGRAM_CHAT_ID` empty and run:
   ```bash
   pnpm alerts:test
   ```
   It checks the token and lists the chats that have messaged your bot. Copy your chat id into
   `.env`.
4. Run `pnpm alerts:test` again. It sends a test message, and when that arrives, you're set.

**What gets sent:**

| Alert | When | Setting |
| --- | --- | --- |
| 🟢 Bought | a position opens: size, price, filter score, chart link | `ALERT_ON_NEW_POSITION` |
| ✅ / 🔻 Sold | a position closes: P&L, peak gain, hold time, reason | `ALERT_ON_EXIT` |
| 🚨 Rug | the rug watcher force-sold a position | `ALERT_ON_EXIT` |
| ⛔ Halted / ▶️ Resumed | the drawdown circuit trips or clears | `ALERT_ON_DRAWDOWN_HALT` |
| 📊 Daily report | once a day: trades, win rate, realized P&L, best and worst | `ALERT_ON_DAILY_PNL`, `ALERT_DAILY_PNL_HOUR_UTC` |
| ⚙️ Engine online / stopping | boot and shutdown, including how many positions are left unmanaged | `ALERT_ON_ENGINE_STATUS` |

Every message starts with **[PAPER]** or **🔴 LIVE**, so a simulated trade can never be mistaken
for a real one.

**Built so alerts never hurt the bot, and never go quiet by accident:**

- Sending happens in the background. A slow or unreachable Telegram never delays a trade.
- A burst of events, such as ten positions closing at once, arrives as **one** message.
- Rate limits are respected: the bot waits exactly as long as Telegram asks, and network errors
  retry with backoff.
- If Telegram stays down, the backlog is capped. Routine alerts are dropped before halt alerts,
  and the next message that gets through says how many were missed.
- Token names are chosen by whoever launched the token, so they are escaped, cleaned of
  invisible and right-to-left spoofing characters, and length-limited before they reach your chat.
- A wrong token or chat id is reported once at startup, with how to fix it. It does not fail
  quietly on every trade.
- The daily report reads from Postgres, so it survives restarts. If the database is down, the
  report says exactly which period it covers instead of presenting part of a day as all of it.
- The bot token is never written to logs.

---

## Configuration

`.env.example` lists every setting with a working default. The ones you are most likely to change:

| Setting | Default | Meaning |
| --- | --- | --- |
| `SYNTHETIC_FEED` | `false` | generate fake launches instead of reading Helius |
| `PAPER_STARTING_BALANCE_USD` | `10000` | paper bankroll |
| `POSITION_SIZE_PCT` | `1.0` | bankroll % per trade |
| `MAX_CONCURRENT_POSITIONS` | `10` | open positions at once |
| `TP_LADDER` | `50:25,100:25,300:25,900:15` | `gain%:sell%` steps |
| `STOP_LOSS_PCT` | `-40` | hard stop |
| `FILTER_MIN_FILTER_SCORE` | `70` | minimum weighted score to buy |
| `FILTER_LIQUIDITY_MIN_USD` / `_MAX_USD` | `5000` / `500000` | liquidity window |
| `DAILY_DRAWDOWN_LIMIT_PCT` | `10` | daily loss that halts entries |
| `ENABLE_PUMPFUN`, `ENABLE_RAYDIUM_AMM`, … | | which DEXes to watch |

Every value is validated at startup, and the engine refuses to start with a clear message rather
than run on a typo.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev:engine` / `pnpm dev:dashboard` | run with reload on save |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | unit tests (Node's built-in runner, no extra dependencies) |
| `pnpm alerts:test` | check the Telegram setup and send a test message |
| `pnpm fixtures:label` | label stored pools rug / good / honeypot by what happened on chain, into `apps/engine/fixtures/` |
| `pnpm docker:up` / `docker:down` / `docker:logs` | local Redis and Postgres |
| `pnpm prisma:migrate` | apply database migrations |

## Project layout

```
apps/
  engine/                 Node + TypeScript: the bot
    src/
      feeds/              Helius log stream, per-DEX parsers, synthetic feed
      filters/            the twelve filters and the orchestrator
      execution/          paper executor, price simulator, trader
      exits/              exit engine (TP / SL / trailing / time), rug watcher
      risk/               drawdown circuit breaker
      analytics/          P&L tracker, per-filter performance, backtest
      alerts/             Telegram alerts: formatting, delivery queue, daily report
      labeling/           outcome-based fixture labels from on-chain history
      api/                Socket.IO server for the dashboard
      state/              Postgres (Prisma), Redis streams, position store, presets
    prisma/               schema and migrations
  dashboard/              Next.js 15 + Tailwind + Zustand
packages/
  shared/                 types shared by engine and dashboard
docker-compose.yml        Redis + Postgres for local development
MEMECOIN_SNIPER_PLAN.md   the full design and phase plan
```

## Security

- **Secrets live only in `.env`**, which git ignores, along with keypair files, `*.pem` and
  `*.key`. Only `.env.example` is committed, and it contains no values.
- **Paper mode needs no wallet.** `SOLANA_KEYPAIR_PATH` stays empty.
- `MODE=live` refuses to start unless `ENABLE_LIVE_TRADING=true` and a keypair path are also set.
  Even then, no live executor exists yet.
- The logger redacts API key fields, and the Telegram token never reaches a log line.
- The Postgres password in `docker-compose.yml` is a local development default. Change it if the
  database is ever reachable from outside your machine.

## Status

| Phase | State |
| --- | --- |
| 0 · Setup: monorepo, Docker, Prisma, env validation | ✅ done |
| 1 · Pool detection: Helius logs, pump.fun / PumpSwap / Raydium parsers | ✅ done |
| 2 · Filter engine: twelve filters, orchestrator, stored verdicts | ✅ code complete, validation against labelled tokens pending |
| 3 · Paper trading: executor, exits, rug watcher, P&L | ✅ done |
| 4 · Analytics: per-filter stats, presets, backtest | ✅ done |
| Telegram alerts | ✅ done |
| 5 · Paper validation: 2–3 weeks of continuous paper trading | ⏳ next |
| 6 · Live mode: encrypted keypair, Jito bundles, confirmation UI | ⛔ not started |

Live trading will only be built after the paper results meet the validation criteria in
[`MEMECOIN_SNIPER_PLAN.md`](MEMECOIN_SNIPER_PLAN.md).

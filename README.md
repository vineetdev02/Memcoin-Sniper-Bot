<div align="center">

# Memecoin Sniper Bot

**A Solana memecoin sniper built around what it refuses to buy.**

It watches pump.fun, PumpSwap and Raydium for new pools, runs every launch through fourteen rug and
honeypot checks, paper-trades the survivors with disciplined exits, and shows all of it on a live
dashboard.

[![CI](https://github.com/vineetdev02/Memcoin-Sniper-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/vineetdev02/Memcoin-Sniper-Bot/actions/workflows/ci.yml)
![Solana](https://img.shields.io/badge/Solana-mainnet-9945FF?logo=solana&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)
![Mode](https://img.shields.io/badge/mode-paper%20by%20default-2ea44f)
![License](https://img.shields.io/badge/license-MIT-blue)

![The Live page: new pools as they are detected, each with a pass or fail pill for every filter](screenshots/live.png)

<sub>Every screenshot comes from the built-in synthetic feed, which generates fake launches.
None of the numbers are real trading results.</sub>

</div>

> [!IMPORTANT]
> **Paper mode is the default, and it is the only mode that trades.** It needs no wallet, no keys
> and no real funds. A live executor has not been built yet (see [Roadmap](#roadmap)). None of
> this is financial advice. Most new memecoins go to zero within a day, and this project is built
> around that assumption.

If this project is useful to you, or it just taught you how rugs work, a ⭐ helps other people
find it.

<details>
<summary><b>Contents</b></summary>

- [Highlights](#highlights)
- [Screenshots](#screenshots)
- [Why filter-first](#why-filter-first)
- [How it works](#how-it-works): the pipeline, the fourteen filters, exits and risk
- [Quick start](#quick-start)
- [The dashboard](#the-dashboard)
- [Telegram alerts](#telegram-alerts)
- [Configuration](#configuration)
- [Scripts](#scripts) · [Project layout](#project-layout) · [Testing](#testing)
- [Security](#security)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [Contributing](#contributing)

</details>

---

## Highlights

- **Thirteen filters on every launch.** They run in parallel, and each pool gets a weighted score.
  Every verdict is stored, so you can later check which filters actually predicted winners.
- **The sell is tested before the buy.** A 0.01 SOL round trip through Jupiter catches honeypots
  that let you in but never let you out.
- **Dev history counts.** A creator whose last twenty tokens went to zero is rejected before they
  can make it twenty-one.
- **Paper trading that doesn't flatter you.** It enters at Jupiter's executable quote, and it
  models slippage from pool depth, failed fills, MEV sandwich losses and Jito tips.
- **Exits that run on their own.** A take-profit ladder, a stop-loss, a trailing stop, a time
  exit, and a rug watcher that force-sells when liquidity is pulled.
- **A circuit breaker for bad days.** Daily and weekly drawdown limits, plus a losing-streak
  limit, halt new entries while exits keep running.
- **A live dashboard with seven pages,** filter presets, and a backtester that replays stored
  pools through any preset.
- **Telegram alerts** for buys, sells, rugs, halts and a daily P&L report.
- **Runs without any API key.** The synthetic feed exercises the whole pipeline on fake launches,
  rugs included.
- **Costs nothing until you switch it on.** The bot starts OFF and does not touch the RPC
  provider until you press the button.

## Screenshots

| Open positions with live P&L | Analytics: which filters predict winners |
| --- | --- |
| ![Open paper positions with live P&L and take-profit ladder progress](screenshots/positions.png) | ![Analytics: win rate, profit factor and per-filter results](screenshots/analytics.png) |
| **Stats: results by window, DEX and close reason** | **Filters: toggle, tune and save presets** |
| ![Stats: bankroll over time, top winner and loser, results by DEX and by close reason](screenshots/stats.png) | ![The Filters page with the Safe Sniper preset active](screenshots/filters.png) |

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
 PumpPortal (free WebSocket)        ┌─────────────────────────────┐
 pump.fun launches · migrations ──▶ │ Pool detector               │  normalise every DEX to one PoolEvent
                                    └──────────────┬──────────────┘
                                                   ▼
                                                   │ waits EVAL_DELAY_SEC (90s)
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │ Filter orchestrator         │  14 filters in parallel, weighted score
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

### The fourteen filters

| Filter | Rejects when | Weight |
| --- | --- | --- |
| `honeypot-sim` | a 0.01 SOL buy-and-sell round trip through Jupiter cannot sell, or costs more than the max sell tax (a pump.fun curve passes: its program executes every sell) | 15 |
| `dev-wallet` | the creator launched 3+ other coins in the last 24 hours (a launch farm), or is a known rugger | 12 |
| `mint-authority` | the dev can still mint more supply | 10 |
| `freeze-authority` | the dev can still freeze holders' tokens | 10 |
| `lp-locked` | liquidity is neither burned nor locked | 10 |
| `top-holders` | the largest holder, or the top ten together, hold too much | 8 |
| `bundled-launch` | the first block was bought by wallets funded from one source | 8 |
| `insider-detection` | the creator was funded by a flagged wallet | 6 |
| `liquidity-min` | liquidity is too thin to exit, or too deep to still be early | 5 |
| `volume-velocity` | buy/sell flow and unique buyers look inorganic | 4 |
| `curve-demand` | a pump.fun curve holds under 1 SOL of buying: nobody is holding the coin | 4 |
| `anti-sniper-war` | the first block was already crowded with snipers | 4 |
| `social-signal` | its DexScreener profile shows too little social presence (no profile at all is unknown: profiles are paid) | 3 |
| `smart-money` | none of the wallets that keep buying graduates bought it in its first 15 s (pump.fun only; off unless a preset turns it on) | 8 |

Every filter can be toggled and tuned from the dashboard, and settings can be saved as presets
(**Safe**, **Aggressive**, **Hot Start** and **Learning** ship built in). Every verdict is stored, so the
analytics page can show which filters actually predict winners.

**Hot Start** is pump.fun only and buys a curve that already holds 20 SOL when it is judged; set
*Wait before judging* to 15 s with it. Of 1,052 shadow-tracked launches on the first night, that
was the one group that made money in both halves of the night (+$5.89 a trade over 21, while
buying every launch at the same moment lost $4.53 a trade over 572). **On the launches that came
after it was chosen it did not hold:** -$3.85 a trade over 43 replayed, and -$18.10 over 12 real
paper trades. It loses less than buying everything ($5.32 a trade over the same launches), but
nothing tells it apart from break-even, let alone a profit. Treat it as the least-bad rule found so far, not a profitable one; the strategy
check below keeps scoring it as launches come in.

### Exits and risk

- **Take-profit ladder**: by default it sells 25% at +50%, 25% at +100%, 25% at +300% and 15% at
  +900% (`TP_LADDER`).
- **Stop-loss** at -40%, a **trailing stop** that arms after +200%, and a **time exit** for
  positions that never move.
- **Real prices**: a paper trade on a real pool enters at what a real buy of that size would pay
  (Jupiter's executable quote), and only when Jupiter's price index agrees within -20%/+25%. An
  index 114× too high once cost a whole position. After entry, the position is marked and sold at
  the index, polled every 3 seconds. A move of 3× or more in one poll is held until the next poll
  confirms it, so one bad tick cannot fire a take-profit or a stop. Only synthetic-feed pools use
  the price simulator.
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

The paper executor models slippage from pool depth, failed fills, MEV sandwich losses, Jito
tips and pump.fun's 1.25% fee on curve sells (a buy's quote already pays it), so paper results
are not flattering fiction.

### Testing a strategy before it trades

The bot buys a few dozen coins a night; the shadow tracker (`SHADOW_TRACKING`) follows *every*
pump.fun launch, bought or not, by reading its bonding curve every 3 seconds for 22 minutes. The
**strategy check** on the Analytics page replays the current settings on those paths: buy
*Wait before judging* + 2 seconds after launch when the curve holds the Demand filter's minimum,
then run the stop-loss, ladder, trailing stop and time exit exactly as the exit engine does. Each
trade moves along the curve's own x·y=k and pays pump.fun's fee both ways and the average
sandwich, and exits fill 3 seconds late. Set against ten of the bot's own paper trades it came out
about $2 a trade kinder in total, with single trades off by as much as $30 either way, so read
its totals rather than any one trade. It shows the result per trade with a 95% range, in each
half of the window, against buying every launch at the same moment, and at other entry delays.
A rule only *holds* when the whole range is above break-even and both halves made money; with
twenty or fifty trades and a handful of graduations carrying every winner, most rules land on
"cannot be told apart from break-even", and that is the honest answer.

What two nights of it found, so nobody has to find it again:

- **Buying every launch loses $4-6 a trade at any delay from 10 s to 90 s**, on both nights,
  well outside the range of luck (-$4.60, range -$5.73 to -$3.46, over 1,112). Fees, the
  sandwich and price impact cost about 4% a round trip, and the average launch only falls.
- **Launch farms almost never graduate.** About two in five launches come from a wallet that
  had already launched 3+ coins that day; 1 of their 645 graduated, against 10 of 615 first
  launches, and that held on fresh launches. Dev History fails them
  (`FILTER_DEV_MAX_LAUNCHES_24H`), counted from the pools the bot has already recorded, so it
  needs no outside service. On the first night they also lost more per trade; on fresh launches
  they did not ($4.49 a trade against $4.99 for everyone else), so it is a safety rule, not a
  profit lever. The Demand line already keeps most of them out of Hot Start (4 of its 41 trades).
- **Filters that judge the early trading do not help.** Sniper War's rejects pumped 7.3% of
  the time, its passes 1.9%: it turns away the coins with demand. The Analytics page shows
  this per filter.
- **A full curve 15-20 s in was the best group on the first night and did not hold on the
  next.** That is the Hot Start preset: +$5.89 a trade before it was chosen, -$3.85 after (n=43). A
  rule picked from one night's data has to be tested on launches it has not seen; this one was,
  and failed.
- **Tuning the exits on one night overfits too.** Of 240 combinations of stop-loss, trailing
  stop, time exit and ladder, none made buying every launch profitable on either night. For Hot
  Start, the set that did best on the first night (+$17 a trade) ranked 196th of 240 on the next
  (-$8.48); the current exits sat in between both times. Set the exits for the risk you want,
  not because a replay liked them.
- **Wallets that keep picking graduates do pick them, and buying behind them still loses.**
  Early buyers of 3,564 launches were read from the chain. Picked the way the Smart Money filter
  picks them, from launches that had already ended, the wallets bought 82 later launches in
  their first 15 s, and 16% of those graduated against 1% of the rest. Bought at 17 s they lost
  $6.94 a trade (range -$10.30 to -$3.60), and at 3 s $7.63. Wallets that made money on one
  night's replays, and launches with 8+ early buyers, both lost on the next.
- **The loss is there before any cost.** With no fee, no sandwich, no latency and no graduation
  haircut, buying every launch 1 s after the feed sees it still loses $5.56 a trade (n=885), and
  the Smart Money launches $3.32. The feed sees a launch about 2 s after it is created, after
  the same-block snipers have bought, and they sell into whoever comes next. No filter or exit
  setting measured here turns that around; trading earlier than the feed can see is a different
  bot.

---

## Quick start

**Requirements:** Node.js 22 or newer, pnpm 10, and Docker.

### Try it in one command

```bash
git clone https://github.com/vineetdev02/Memcoin-Sniper-Bot.git
cd Memcoin-Sniper-Bot
pnpm install
pnpm demo
```

Open the dashboard URL it prints. Fake launches start arriving within seconds, get filtered, and
the survivors are paper-traded, rugs and stop-losses included. The demo needs no API key and no
`.env`, runs its own throwaway Postgres and Redis on free ports, and uses nothing from your `.env`
if you have one, so your own keys and paper-trading history are never touched. Ctrl+C stops everything and deletes the
demo database.

### Full setup

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

**With a Helius key** (a free one is enough to start), put it in `HELIUS_API_KEY`. New pools come
from PumpPortal's free feed; Helius answers the filters' on-chain checks.

Then run the engine and the dashboard in two terminals:

```bash
pnpm dev:engine       # the bot itself
pnpm dev:dashboard    # http://localhost:3000
```

**The bot starts off.** Until you press **Bot OFF → ON** in the dashboard header, the engine does
not even connect to the RPC provider: no pools are detected, filtered or traded, and no Helius
credits are spent. Every restart turns it off again. Pressing it off unsubscribes and stops new
entries. Open positions keep their take-profits, stop-losses and rug watch, none of which use RPC.
Stopping the engine (Ctrl+C) in paper mode sells whatever is still open at the market first, so a
session never leaves tokens to die while nothing watches them; `SELL_ON_SHUTDOWN=false` keeps them
open for the next run instead. A token nobody quotes any more cannot be sold and stays open.
The **RPC** counter next to the button is every request the engine has sent since it started,
which is roughly the credits spent. The Backtest page is the one other thing that spends them:
each replayed pool runs the preset's filters against the RPC, even while the bot is off.

## The dashboard

| Page | What it shows |
| --- | --- |
| **Live** | new pools as they are detected, with a pass/fail pill per filter |
| **Positions** | open paper positions, live P&L, TP ladder progress |
| **History** | every closed trade and why it closed |
| **Stats** | trade results over a window from 10 minutes to all time, broken down by DEX and by close reason |
| **Analytics** | the strategy check, what each filter turned away, win rate, profit factor, per-filter lift, results by DEX and hour |
| **Filters** | toggle and tune filters, save and activate presets |
| **Backtest** | replay stored pools through any preset without touching live trading |
| **Settings** | change sizing, exits, risk limits and the filter delay while it runs; start the paper account over at a new amount |

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

Most trading settings can also be changed on the dashboard's **Settings** page. A value saved
there overrides `.env` and survives restarts; the page shows the `.env` value next to anything
changed. Exits are fixed when a position opens, so a new stop-loss or ladder applies to the next
buy. **Reset paper account** on the same page starts over at a new amount: it needs the bot off,
writes everything it deletes to `apps/engine/backups/` first, and keeps presets and settings.

`.env.example` lists every setting with a working default. The ones you are most likely to change:

| Setting | Default | Meaning |
| --- | --- | --- |
| `SYNTHETIC_FEED` | `false` | generate fake launches instead of reading a real feed |
| `POOL_FEED` | `pumpportal` | where new pools come from: `pumpportal` (free) or `helius` (see the FAQ) |
| `PAPER_STARTING_BALANCE_USD` | `10000` | paper bankroll |
| `POSITION_SIZE_PCT` | `1.0` | bankroll % per trade |
| `MAX_CONCURRENT_POSITIONS` | `10` | open positions at once |
| `TP_LADDER` | `50:25,100:25,300:25,900:15` | `gain%:sell%` steps |
| `STOP_LOSS_PCT` | `-40` | hard stop |
| `FILTER_MIN_FILTER_SCORE` | `70` | minimum weighted score to buy |
| `FILTER_MIN_CURVE_SOL` | `1` | the Demand filter: SOL a pump.fun curve must hold when it is judged |
| `FILTER_DEV_MAX_LAUNCHES_24H` | `3` | Dev History: a creator with this many other launches in 24 hours is a launch farm (`0` = off) |
| `FILTER_LIQUIDITY_MIN_USD` / `_MAX_USD` | `5000` / `500000` | liquidity window |
| `EVAL_DELAY_SEC` | `90` | how long a new pool waits before it is judged |
| `DAILY_DRAWDOWN_LIMIT_PCT` | `10` | daily loss that halts entries |
| `SELL_ON_SHUTDOWN` | `true` | paper: sell open positions at the market when the engine stops |
| `WATCH_ONLY` | `false` | Bot ON detects, judges and shadow-tracks launches but opens no positions |
| `SHADOW_TRACKING` | `true` | follow every pump.fun launch's curve for 22 min from detection, bought or not, and write the path, the filters' view and, with a PumpPortal API key funded with 0.02 SOL, every trade of its first 150 s to `apps/engine/data/shadow/` (about one RPC request a second) |
| `ENABLE_PUMPFUN`, `ENABLE_PUMPSWAP`, `ENABLE_RAYDIUM_AMM` | | which DEXes to watch |

Every value is validated at startup, and the engine refuses to start with a clear message rather
than run on a typo.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm demo` | the whole bot on the synthetic feed, with a throwaway database, in one command |
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
      feeds/              PumpPortal and Helius streams, per-DEX parsers, synthetic feed
      filters/            the fourteen filters and the orchestrator
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
scripts/demo.mjs          `pnpm demo`: engine + dashboard on the synthetic feed, throwaway database
docker-compose.yml        Redis + Postgres for local development
MEMECOIN_SNIPER_PLAN.md   the full design and phase plan
FILTER_QUALITY_PLAN.md    how the filters get validated against labelled launches
```

## Testing

```bash
pnpm typecheck
pnpm test
```

126 tests across the filters, parsers, exit engine, rug watcher, trader, position store, Telegram
client and the dashboard's money formatting. They run on Node's built-in test runner and need no
network, database or API key. A `.env` copied from `.env.example` is all they read.

[CI](.github/workflows/ci.yml) runs the typecheck, the tests and a production build of the
dashboard on every push and pull request.

## Security

- **Secrets live only in `.env`**, which git ignores, along with keypair files, `*.pem` and
  `*.key`. Only `.env.example` is committed, and it contains no values.
- **Paper mode needs no wallet.** `SOLANA_KEYPAIR_PATH` stays empty.
- `MODE=live` refuses to start unless `ENABLE_LIVE_TRADING=true` and a keypair path are also set.
  Even then, no live executor exists yet.
- The logger redacts API key fields, and the Telegram token never reaches a log line.
- The Postgres password in `docker-compose.yml` is a local development default. Change it if the
  database is ever reachable from outside your machine.

---

## Roadmap

| Phase | State |
| --- | --- |
| 0 · Setup: monorepo, Docker, Prisma, env validation | ✅ done |
| 1 · Pool detection: Helius logs, pump.fun / PumpSwap / Raydium parsers | ✅ done |
| 2 · Filter engine: fourteen filters, orchestrator, stored verdicts | ✅ code complete, validation against labelled tokens pending |
| 3 · Paper trading: executor, exits, rug watcher, P&L | ✅ done |
| 4 · Analytics: per-filter stats, presets, backtest | ✅ done |
| Telegram alerts | ✅ done |
| 5 · Paper validation: 2–3 weeks of continuous paper trading | ⏳ next |
| 6 · Live mode: encrypted keypair, Jito bundles, confirmation UI | ⛔ not started |

Live trading will only be built after paper trading clears every one of these
([`MEMECOIN_SNIPER_PLAN.md`](MEMECOIN_SNIPER_PLAN.md) §8):

| Over at least 2 weeks of paper trading | Required |
| --- | --- |
| Total trades | more than 200 |
| Win rate | above 15% |
| Average win ÷ average loss | above 3.0 |
| Sharpe ratio | above 1.5 |
| Maximum drawdown | below 30% |
| Trades that returned more than 5× | at least 5 |
| Worst single day | no loss over 20% |

If any of them fails, the filters get tuned and the paper run starts again.

---

## FAQ

<details>
<summary><b>Can it trade real money?</b></summary>

No. Paper mode is the only mode that trades. `MODE=live` refuses to start without
`ENABLE_LIVE_TRADING=true` and a keypair path, and even with both set there is no live executor
to send a transaction. That will stay true until the paper results clear the
[validation gate](#roadmap).

</details>

<details>
<summary><b>Does it make money?</b></summary>

Nobody knows yet, and that is the honest answer. Finding out is what phase 5 is for. Results from
the synthetic feed say nothing about real markets: it exists to exercise the code, not to predict
returns.

</details>

<details>
<summary><b>What do I need to pay for?</b></summary>

Nothing, to try it. The synthetic feed needs no key at all. Real launches come from PumpPortal's
free feed, which needs no key either. The filters' on-chain checks need an RPC: a free Helius key
works, and without one they fall back to the public Solana RPC, which rate-limits hard. Helius is
the only key the engine uses. Jupiter, RugCheck and DexScreener are called without one.

</details>

<details>
<summary><b>How many Helius credits will it use?</b></summary>

None while the bot is off, which is how it starts every time. While it is on, the **RPC** counter
in the dashboard header shows every request sent since startup. Running a backtest spends credits
too, even with the bot off.

Each pump.fun launch costs about 6 credits under the Safe Sniper preset (mint and freeze authority,
top holders, early-buyer activity). Measured on 2026-10-28, pump.fun saw 8–19 launches a minute, so
the free plan's 1M credits a month covers roughly 5–11 hours of running a day, not all day.
Credits running out on the free plan stops the RPC calls; it does not bill you.

`POOL_FEED=helius` is the older way to find pools: a log subscription to each enabled DEX program.
It covers Raydium AMM as well, but those logs include every trade on the program, and since April
2026 Helius bills WebSocket traffic at 2 credits per 0.1 MB, so it costs far more than the
filters do.

</details>

<details>
<summary><b>Why does it wait 90 seconds before judging a pool?</b></summary>

At the moment a pool is created there is no honeypot quote, no trading volume and no social
profile yet, so several filters could only say "unknown". Judging it a little later means each
filter gets a real answer. Change it with `EVAL_DELAY_SEC`.

</details>

<details>
<summary><b>Can I add another DEX?</b></summary>

Yes. Each DEX has a parser in `apps/engine/src/feeds/parsers/` that turns its pool-creation logs
into one common `PoolEvent`, and its program id is listed in `program-ids.ts`. Raydium CLMM,
Raydium Launchpad, Meteora and Orca already have program ids and switches in `.env`, but no
parsers yet. Turning one on subscribes to its logs and then skips every one of them, so leave them
off for now. Writing those parsers is a good first contribution.

</details>

---

## Contributing

Issues and pull requests are welcome. The most useful contributions are:

- **Labelled launches.** `pnpm fixtures:label` labels stored pools by what actually happened on
  chain. More labelled rugs and good launches make the filters measurably better.
- **New DEX parsers** (see the [FAQ](#faq)).
- **Filter ideas**, especially ones with data showing they separate rugs from good launches.

Before opening a pull request, run `pnpm typecheck && pnpm test`.

## Disclaimer

This software is for research and education. It is not financial advice, and nothing in it
promises a profit. Trading memecoins is extremely risky, and most of them go to zero. If you build
live trading on top of this code, you are responsible for what it does with your money.

## License

[MIT](LICENSE)

---

<div align="center">

**If this saved you from a rug, or just made one easier to understand, consider leaving a ⭐.**
**It is the main way other people find the project.**

</div>

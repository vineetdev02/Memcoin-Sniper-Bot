import type { PoolEvent } from "@sniperbot/shared";
import type { PumpPortalLaunchInfo, PumpPortalTrade } from "../feeds/pumpportal-ws.js";

/** [seconds since detection, 1 for a buy or -1 for a sell, SOL, wallet: 0 is the creator, then in order of first trade] */
export type TapeTrade = [number, 1 | -1, number, number];

export interface LaunchTapeRecord {
  name?: string;
  symbol?: string;
  devBuySol?: number;
  wallets: number;
  trades: TapeTrade[];
}

interface Recording {
  detectedAt: number;
  info: PumpPortalLaunchInfo;
  wallets: Map<string, number>;
  trades: TapeTrade[];
  timer: NodeJS.Timeout;
}

// a launch in a frenzy can trade hundreds of times a minute; past this the tape stops growing
const MAX_TRADES = 600;

/**
 * Every buy and sell in the first minutes of each pump.fun launch, from
 * PumpPortal's token-trade feed: who traded, which way, how much, and whether
 * the creator sold. Curve reads show where the price went; the tape shows who
 * moved it, which is what a strategy can actually tell apart at entry.
 */
export class LaunchTape {
  private readonly recording = new Map<string, Recording>();
  private tradesSeen = 0;

  constructor(
    private readonly feed: {
      watchTrades(mints: string[]): void;
      unwatchTrades(mints: string[]): void;
      tradesAvailable(): boolean;
    },
    private readonly onDone: (mint: string, tape: LaunchTapeRecord) => void,
    private readonly tapeMs = 150_000,
  ) {}

  start(pool: PoolEvent): void {
    if (pool.source !== "pumpfun" || this.recording.has(pool.tokenMint) || !this.feed.tradesAvailable()) return;
    const timer = setTimeout(() => this.finish(pool.tokenMint), this.tapeMs);
    timer.unref();
    this.recording.set(pool.tokenMint, {
      detectedAt: pool.detectedAt,
      info: (pool.rawEvent as PumpPortalLaunchInfo | undefined) ?? {},
      wallets: new Map([[pool.creatorWallet, 0]]),
      trades: [],
      timer,
    });
    this.feed.watchTrades([pool.tokenMint]);
  }

  record(t: PumpPortalTrade): void {
    const r = this.recording.get(t.mint);
    if (!r || r.trades.length >= MAX_TRADES) return;
    this.tradesSeen++;
    let w = r.wallets.get(t.trader);
    if (w === undefined) {
      w = r.wallets.size;
      r.wallets.set(t.trader, w);
    }
    r.trades.push([
      Math.round((t.receivedAt - r.detectedAt) / 100) / 10,
      t.side === "buy" ? 1 : -1,
      Math.round(t.sol * 1000) / 1000,
      w,
    ]);
  }

  /** Hands over what was recorded so far, so a stopping engine loses no tape. */
  stop(): void {
    for (const mint of [...this.recording.keys()]) this.finish(mint);
  }

  getStats() {
    return { recording: this.recording.size, tradesSeen: this.tradesSeen };
  }

  private finish(mint: string): void {
    const r = this.recording.get(mint);
    if (!r) return;
    clearTimeout(r.timer);
    this.recording.delete(mint);
    // refused part-way: an empty tape would read as "nobody traded", so there is none
    if (!this.feed.tradesAvailable()) return;
    this.feed.unwatchTrades([mint]);
    this.onDone(mint, { ...r.info, wallets: r.wallets.size, trades: r.trades });
  }
}

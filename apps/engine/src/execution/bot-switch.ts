import { childLogger } from "../utils/logger.js";

const log = childLogger("bot-switch");

/** The parts of the engine the switch turns on and off. */
export interface SwitchParts {
  feed: { start(): Promise<void>; stop(): Promise<void>; isLive(): boolean };
  detector: { clearPending(): void };
  orchestrator: { setLive(on: boolean): void };
  trader: { setEnabled(on: boolean): void };
}

/**
 * One switch for the whole bot, off at every boot. Off means no subscription
 * to the RPC provider, so no pool is parsed or filtered and no credit is spent.
 * Open positions keep running their exits either way; those need no RPC.
 */
export class BotSwitch {
  private readonly parts: SwitchParts;
  private on = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(parts: SwitchParts) {
    this.parts = parts;
  }

  isOn(): boolean {
    return this.on;
  }

  feedLive(): boolean {
    return this.parts.feed.isLive();
  }

  /** Applied one at a time, in order, so a double click cannot subscribe twice. */
  set(on: boolean): Promise<void> {
    const next = this.chain.then(() => this.apply(on));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async apply(on: boolean): Promise<void> {
    if (on === this.on) return;
    const p = this.parts;
    if (on) {
      p.orchestrator.setLive(true);
      try {
        await p.feed.start();
      } catch (err) {
        p.orchestrator.setLive(false);
        throw err;
      }
      p.trader.setEnabled(true);
      this.on = true;
      log.warn({ feedLive: p.feed.isLive() }, "bot ON — listening for pools and trading");
      return;
    }
    // Trading stops first, then everything that spends.
    this.on = false;
    p.trader.setEnabled(false);
    p.orchestrator.setLive(false);
    await p.feed.stop();
    p.detector.clearPending();
    log.warn("bot OFF — no RPC subscription, no new trades");
  }
}

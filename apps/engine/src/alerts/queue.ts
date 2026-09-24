import { droppedNote, htmlToPlain } from "./format.js";
import { fatalHint, type Outcome } from "./telegram.js";

/**
 * Sends alerts to Telegram without ever blocking or crashing the engine.
 *
 *  • Enqueue is synchronous and returns immediately; delivery happens in the
 *    background, one request at a time, at most one per `minIntervalMs`
 *    (Telegram allows roughly one message a second per chat).
 *  • Whatever piles up while a request is in flight goes out as ONE message,
 *    so a kill switch closing ten positions is one notification, not ten.
 *  • The backlog is bounded. When Telegram is unreachable for a long time the
 *    oldest normal alerts are dropped first — a halt alert is the last thing
 *    to go — and the next message that does get through says how many.
 *  • 429 waits exactly as long as Telegram asks; 5xx and network errors back
 *    off; a message Telegram cannot parse is re-sent as plain text; a bad
 *    token or chat id disables alerts with one clear log line instead of
 *    failing every message for the rest of the run.
 */

export type Priority = "critical" | "normal";

export interface AlertLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface AlertSink {
  enqueue(text: string, priority?: Priority): void;
  flush(timeoutMs: number): Promise<boolean>;
  disable(reason: string): void;
  getStats(): AlertQueueStats;
}

export interface AlertQueueStats {
  sent: number;
  messages: number;
  failed: number;
  dropped: number;
  queued: number;
  disabled: string | null;
}

export interface AlertQueueOptions {
  client: { sendMessage(text: string, opts: { html: boolean }): Promise<Outcome> };
  log: AlertLog;
  minIntervalMs?: number;
  maxQueued?: number;
  maxMessageChars?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Item {
  text: string;
  priority: Priority;
}

const SEPARATOR = "\n\n";
// Telegram's hard limit is 4096 characters after entities are parsed; leave
// room for the markup so the raw text can never be the reason a send fails.
const TELEGRAM_SAFE_CHARS = 3800;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    // unref: a pending retry must not keep a shutting-down engine alive.
    setTimeout(resolve, ms).unref();
  });

export class AlertQueue implements AlertSink {
  private readonly client: AlertQueueOptions["client"];
  private readonly log: AlertLog;
  private readonly minIntervalMs: number;
  private readonly maxQueued: number;
  private readonly maxMessageChars: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  private items: Item[] = [];
  private draining = false;
  private scheduled = false;
  private nextSendAt = 0;
  private unreportedDrops = 0;
  private disabledReason: string | null = null;
  private idleWaiters: Array<() => void> = [];
  private readonly stats = { sent: 0, messages: 0, failed: 0, dropped: 0 };

  constructor(opts: AlertQueueOptions) {
    this.client = opts.client;
    this.log = opts.log;
    this.minIntervalMs = opts.minIntervalMs ?? 1100;
    this.maxQueued = opts.maxQueued ?? 100;
    this.maxMessageChars = Math.min(opts.maxMessageChars ?? TELEGRAM_SAFE_CHARS, TELEGRAM_SAFE_CHARS);
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
  }

  enqueue(text: string, priority: Priority = "normal"): void {
    if (this.disabledReason) return;
    this.items.push({ text: this.clip(text), priority });
    while (this.items.length > this.maxQueued) this.dropOne();
    this.schedule();
  }

  /** Resolves true once everything queued has been handled, false on timeout. */
  flush(timeoutMs: number): Promise<boolean> {
    if (this.isIdle()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  disable(reason: string): void {
    if (this.disabledReason) return;
    this.disabledReason = reason;
    const discarded = this.items.length;
    this.items = [];
    this.log.error({ reason, discarded, hint: fatalHint(reason) }, "Telegram alerts disabled");
    this.notifyIfIdle();
  }

  getStats(): AlertQueueStats {
    return {
      ...this.stats,
      queued: this.items.length,
      disabled: this.disabledReason,
    };
  }

  private isIdle(): boolean {
    return !this.draining && !this.scheduled && this.items.length === 0;
  }

  private notifyIfIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private clip(text: string): string {
    if (text.length <= this.maxMessageChars) return text;
    // Cutting HTML can split a tag; if it does, the plain-text fallback sends it.
    return `${text.slice(0, this.maxMessageChars - 1)}…`;
  }

  private dropOne(): void {
    const idx = this.items.findIndex((i) => i.priority === "normal");
    this.items.splice(idx === -1 ? 0 : idx, 1);
    this.stats.dropped++;
    this.unreportedDrops++;
  }

  /**
   * Start draining on a microtask rather than inline: everything enqueued in
   * the same synchronous burst (e.g. the kill switch's loop) is then already
   * in the queue when the first batch is cut, and goes out together.
   */
  private schedule(): void {
    if (this.draining || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.items.length > 0 && !this.disabledReason) {
        const wait = this.nextSendAt - this.now();
        if (wait > 0) await this.sleep(wait);
        if (this.items.length === 0 || this.disabledReason) break;

        const batch = this.takeBatch();
        const delivered = await this.deliver(batch.text);
        this.nextSendAt = this.now() + this.minIntervalMs;
        if (delivered) {
          this.stats.sent += batch.count;
          this.stats.messages++;
          this.unreportedDrops -= batch.reportedDrops;
        } else {
          this.stats.failed += batch.count;
        }
      }
    } catch (err) {
      // deliver() and sleep() do not throw; this is a last line of defence.
      this.log.error({ err }, "alert queue crashed; pending alerts discarded");
      this.stats.failed += this.items.length;
      this.items = [];
    } finally {
      this.draining = false;
      if (this.items.length > 0 && !this.disabledReason) this.schedule();
      this.notifyIfIdle();
    }
  }

  private takeBatch(): { text: string; count: number; reportedDrops: number } {
    const parts: string[] = [];
    const reportedDrops = this.unreportedDrops;
    let length = 0;
    if (reportedDrops > 0) {
      const note = droppedNote(reportedDrops);
      parts.push(note);
      length = note.length;
    }

    let count = 0;
    while (this.items.length > 0) {
      const next = this.items[0]!;
      const added = (parts.length > 0 ? SEPARATOR.length : 0) + next.text.length;
      // Always take at least one item, so an oversized one cannot jam the queue.
      if (count > 0 && length + added > this.maxMessageChars) break;
      parts.push(next.text);
      length += added;
      this.items.shift();
      count++;
    }
    return { text: this.clip(parts.join(SEPARATOR)), count, reportedDrops };
  }

  private async deliver(text: string): Promise<boolean> {
    let html = true;
    let migrations = 0;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const out = await this.client.sendMessage(html ? text : htmlToPlain(text), { html });
      switch (out.kind) {
        case "ok":
          return true;
        case "fatal":
          this.disable(out.reason);
          return false;
        case "migrated":
          this.log.warn(
            { newChatId: out.chatId },
            "Telegram group was upgraded to a supergroup — set TELEGRAM_CHAT_ID to the new id",
          );
          if (++migrations > 1) return false;
          attempt--; // a migration is a redirect, not a failed attempt
          continue;
        case "bad-request":
          if (html) {
            this.log.warn({ reason: out.reason }, "Telegram rejected the alert's markup; resending as plain text");
            html = false;
            continue;
          }
          this.log.error({ reason: out.reason }, "Telegram rejected an alert");
          return false;
        case "retry": {
          if (attempt === this.maxAttempts) break;
          const backoff = out.afterMs ?? Math.min(30_000, 1000 * 2 ** (attempt - 1));
          this.log.warn({ reason: out.reason, attempt, retryInMs: backoff }, "Telegram send failed; retrying");
          await this.sleep(backoff);
          if (this.disabledReason) return false;
          continue;
        }
      }
    }
    this.log.error({ attempts: this.maxAttempts }, "Telegram send failed; giving up on this alert");
    return false;
  }
}

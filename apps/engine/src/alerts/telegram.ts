/**
 * Minimal Telegram Bot API client. No dependency — Node 22 ships fetch.
 *
 * It never throws. Every call returns an outcome the queue can act on, because
 * the question after a failed send is never "what went wrong" but "is it worth
 * trying again": a 429 is, a bad token is not.
 *
 * The bot token is part of every request URL, so any text that could echo the
 * URL back is passed through `redact` before it leaves this file.
 */

export type Outcome =
  | { kind: "ok"; result: unknown }
  /** Transient: rate limit, 5xx, timeout, network. `afterMs` when Telegram said how long. */
  | { kind: "retry"; reason: string; afterMs?: number }
  /** The group became a supergroup; the client has already switched chat id. */
  | { kind: "migrated"; chatId: string }
  /** This message was rejected. A different message may still go through. */
  | { kind: "bad-request"; reason: string }
  /** The configuration is wrong. Nothing will go through until it is fixed. */
  | { kind: "fatal"; reason: string };

export interface TelegramOptions {
  token: string;
  chatId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  apiBase?: string;
}

interface ApiResponse {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export class TelegramClient {
  private chatId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiBase: string;

  constructor(opts: TelegramOptions) {
    this.token = opts.token;
    this.chatId = opts.chatId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.apiBase = opts.apiBase ?? "https://api.telegram.org";
  }

  get currentChatId(): string {
    return this.chatId;
  }

  sendMessage(text: string, opts: { html: boolean }): Promise<Outcome> {
    return this.call("sendMessage", {
      chat_id: this.chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(opts.html ? { parse_mode: "HTML" } : {}),
    });
  }

  getMe(): Promise<Outcome> {
    return this.call("getMe", {});
  }

  /** Recent messages sent to the bot — how a user discovers their chat id. */
  getUpdates(): Promise<Outcome> {
    return this.call("getUpdates", { limit: 50, allowed_updates: ["message", "channel_post"] });
  }

  redact(s: string): string {
    return this.token ? s.split(this.token).join("<token>") : s;
  }

  private async call(method: string, body: object): Promise<Outcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      const reason = e.name === "TimeoutError" ? `timed out after ${this.timeoutMs}ms` : e.message;
      return { kind: "retry", reason: this.redact(`network: ${reason}`) };
    }

    let json: ApiResponse = {};
    try {
      json = (await res.json()) as ApiResponse;
    } catch {
      // A proxy or an outage page answered instead of Telegram.
    }

    if (res.ok && json.ok) return { kind: "ok", result: json.result };

    const code = json.error_code ?? res.status;
    const reason = this.redact(`${code} ${json.description ?? res.statusText}`.trim());

    if (code === 429) {
      const after = json.parameters?.retry_after;
      return { kind: "retry", reason, afterMs: typeof after === "number" ? after * 1000 : undefined };
    }
    if (json.parameters?.migrate_to_chat_id !== undefined) {
      this.chatId = String(json.parameters.migrate_to_chat_id);
      return { kind: "migrated", chatId: this.chatId };
    }
    if (code >= 500) return { kind: "retry", reason };
    // 401 bad token, 403 bot blocked or kicked, 404 malformed token.
    if (code === 401 || code === 403 || code === 404) return { kind: "fatal", reason };
    // A wrong chat id is a configuration error, not a problem with one message.
    if (/chat not found|user not found|chat_id is empty/i.test(json.description ?? "")) {
      return { kind: "fatal", reason };
    }
    return { kind: "bad-request", reason };
  }
}

/** One line of advice per fatal error, for the log and for the CLI. */
export function fatalHint(reason: string): string {
  if (reason.startsWith("401") || reason.startsWith("404")) {
    return "TELEGRAM_BOT_TOKEN is wrong — copy it again from @BotFather.";
  }
  if (reason.startsWith("403")) {
    return "The bot cannot message this chat — unblock it, or add it back to the group.";
  }
  if (/chat not found|user not found|chat_id is empty/i.test(reason)) {
    return "TELEGRAM_CHAT_ID is wrong, or you have not pressed Start in a chat with the bot yet. Run `pnpm alerts:test` to list chats.";
  }
  return "Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.";
}

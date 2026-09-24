import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TelegramClient } from "./telegram.js";

const TOKEN = "123456789:AAFakeTokenFakeTokenFakeTokenFake00";

interface Call {
  url: string;
  body: Record<string, unknown>;
}

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(responses: Array<{ status: number; json?: unknown; text?: string } | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const next = responses.shift();
    if (!next) throw new Error("fakeFetch: no response scripted");
    if (next instanceof Error) throw next;
    const body = next.json !== undefined ? JSON.stringify(next.json) : (next.text ?? "");
    return new Response(body, { status: next.status });
  }) as typeof fetch;
  return { impl, calls };
}

function client(responses: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(responses);
  return { c: new TelegramClient({ token: TOKEN, chatId: "42", fetchImpl: f.impl }), calls: f.calls };
}

describe("TelegramClient", () => {
  test("ok", async () => {
    const { c, calls } = client([{ status: 200, json: { ok: true, result: { message_id: 1 } } }]);
    const out = await c.sendMessage("hi", { html: true });
    assert.equal(out.kind, "ok");
    assert.equal(calls[0]!.body.parse_mode, "HTML");
    assert.equal(calls[0]!.body.chat_id, "42");
  });

  test("plain sends omit parse_mode", async () => {
    const { c, calls } = client([{ status: 200, json: { ok: true } }]);
    await c.sendMessage("hi", { html: false });
    assert.equal(calls[0]!.body.parse_mode, undefined);
  });

  test("429 carries Telegram's retry_after", async () => {
    const { c } = client([
      { status: 429, json: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } } },
    ]);
    const out = await c.sendMessage("hi", { html: true });
    assert.deepEqual(out, { kind: "retry", reason: "429 Too Many Requests", afterMs: 7000 });
  });

  test("5xx and non-JSON gateway pages are retryable", async () => {
    const { c } = client([
      { status: 500, json: { ok: false, error_code: 500, description: "Internal" } },
      { status: 502, text: "<html>Bad Gateway</html>" },
    ]);
    assert.equal((await c.sendMessage("a", { html: true })).kind, "retry");
    assert.equal((await c.sendMessage("b", { html: true })).kind, "retry");
  });

  test("bad token, blocked bot and unknown chat are fatal", async () => {
    const { c } = client([
      { status: 401, json: { ok: false, error_code: 401, description: "Unauthorized" } },
      { status: 403, json: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } },
      { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: chat not found" } },
    ]);
    for (let i = 0; i < 3; i++) assert.equal((await c.sendMessage("x", { html: true })).kind, "fatal");
  });

  test("a message Telegram cannot parse is a bad request, not a config error", async () => {
    const { c } = client([
      { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } },
    ]);
    assert.equal((await c.sendMessage("<b", { html: true })).kind, "bad-request");
  });

  test("a group upgraded to a supergroup switches chat id", async () => {
    const { c, calls } = client([
      { status: 400, json: { ok: false, error_code: 400, description: "migrated", parameters: { migrate_to_chat_id: -100777 } } },
      { status: 200, json: { ok: true } },
    ]);
    assert.deepEqual(await c.sendMessage("x", { html: true }), { kind: "migrated", chatId: "-100777" });
    await c.sendMessage("x", { html: true });
    assert.equal(calls[1]!.body.chat_id, "-100777");
  });

  test("the token never appears in a failure reason", async () => {
    const { c } = client([new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendMessage`)]);
    const out = await c.sendMessage("x", { html: true });
    assert.equal(out.kind, "retry");
    assert.ok("reason" in out && !out.reason.includes(TOKEN) && out.reason.includes("<token>"));
  });

  test("a hung request times out as retryable", async () => {
    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const c = new TelegramClient({ token: TOKEN, chatId: "42", fetchImpl: hang, timeoutMs: 20 });
    // AbortSignal.timeout does not hold the event loop open; a ref'd timer does.
    const [out] = await Promise.all([c.sendMessage("x", { html: true }), new Promise((r) => setTimeout(r, 50))]);
    assert.equal(out.kind, "retry");
    assert.ok("reason" in out && out.reason.includes("timed out"));
  });
});

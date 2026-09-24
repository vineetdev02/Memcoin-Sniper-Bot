import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AlertQueue } from "./queue.js";
import type { Outcome } from "./telegram.js";
import { recordingLog, silentLog } from "./test-fixtures.js";

interface Sent {
  text: string;
  html: boolean;
}

/**
 * A Telegram stand-in. Outcomes are served in order (then "ok" forever), and
 * `hold()` makes the next send hang until released — a request in flight.
 */
function fakeClient(outcomes: Outcome[] = []) {
  const sent: Sent[] = [];
  let gate: Promise<void> | null = null;
  let release: () => void = () => {};
  return {
    sent,
    hold() {
      gate = new Promise<void>((r) => (release = r));
    },
    release: () => release(),
    async sendMessage(text: string, opts: { html: boolean }): Promise<Outcome> {
      sent.push({ text, html: opts.html });
      if (gate) {
        const g = gate;
        gate = null;
        await g;
      }
      return outcomes.shift() ?? { kind: "ok", result: {} };
    },
  };
}

function queue(client: ReturnType<typeof fakeClient>, opts: Partial<ConstructorParameters<typeof AlertQueue>[0]> = {}) {
  const sleeps: number[] = [];
  const q = new AlertQueue({
    client,
    log: silentLog,
    minIntervalMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...opts,
  });
  return { q, sleeps };
}

describe("AlertQueue", () => {
  test("a synchronous burst goes out as one message", async () => {
    const client = fakeClient();
    const { q } = queue(client);
    for (let i = 1; i <= 10; i++) q.enqueue(`exit ${i}`);
    assert.equal(await q.flush(1000), true);
    assert.equal(client.sent.length, 1);
    assert.ok(client.sent[0]!.text.startsWith("exit 1\n\nexit 2"));
    assert.ok(client.sent[0]!.text.endsWith("exit 10"));
    assert.deepEqual(q.getStats(), { sent: 10, messages: 1, failed: 0, dropped: 0, queued: 0, disabled: null });
  });

  test("alerts arriving while a send is in flight are batched into the next one", async () => {
    const client = fakeClient();
    client.hold();
    const { q } = queue(client);
    q.enqueue("first");
    await new Promise((r) => setImmediate(r));
    q.enqueue("second");
    q.enqueue("third");
    client.release();
    await q.flush(1000);
    assert.deepEqual(client.sent.map((s) => s.text), ["first", "second\n\nthird"]);
  });

  test("batches never exceed the message size limit", async () => {
    const client = fakeClient();
    const { q } = queue(client, { maxMessageChars: 100 });
    for (let i = 0; i < 5; i++) q.enqueue("x".repeat(40));
    await q.flush(1000);
    assert.equal(client.sent.length, 3);
    for (const s of client.sent) assert.ok(s.text.length <= 100);
    assert.equal(q.getStats().sent, 5);
  });

  test("429 waits exactly as long as Telegram asks, then delivers", async () => {
    const client = fakeClient([{ kind: "retry", reason: "429", afterMs: 7000 }]);
    const { q, sleeps } = queue(client);
    q.enqueue("halt");
    await q.flush(1000);
    assert.deepEqual(sleeps, [7000]);
    assert.equal(client.sent.length, 2);
    assert.equal(q.getStats().sent, 1);
  });

  test("network errors back off exponentially and give up after maxAttempts", async () => {
    const retry: Outcome = { kind: "retry", reason: "network" };
    const client = fakeClient([retry, retry, retry, retry]);
    const { q, sleeps } = queue(client, { maxAttempts: 4 });
    q.enqueue("lost");
    await q.flush(1000);
    assert.deepEqual(sleeps, [1000, 2000, 4000]);
    assert.equal(client.sent.length, 4);
    assert.equal(q.getStats().failed, 1);
    assert.equal(q.getStats().sent, 0);
  });

  test("the queue keeps working after a message it had to give up on", async () => {
    const retry: Outcome = { kind: "retry", reason: "network" };
    const client = fakeClient([retry, retry]);
    const { q } = queue(client, { maxAttempts: 2 });
    q.enqueue("lost");
    await q.flush(1000);
    q.enqueue("next");
    await q.flush(1000);
    assert.equal(client.sent.at(-1)!.text, "next");
    assert.equal(q.getStats().sent, 1);
  });

  test("markup Telegram rejects is re-sent as plain text", async () => {
    const client = fakeClient([{ kind: "bad-request", reason: "400 can't parse entities" }]);
    const { q } = queue(client);
    q.enqueue("<b>Bought</b> A &amp; B");
    await q.flush(1000);
    assert.deepEqual(client.sent[1], { text: "Bought A & B", html: false });
    assert.equal(q.getStats().sent, 1);
  });

  test("a fatal error disables alerts once, with a hint, and later alerts are ignored", async () => {
    const client = fakeClient([{ kind: "fatal", reason: "401 Unauthorized" }]);
    const { log, lines } = recordingLog();
    const { q } = queue(client, { log });
    q.enqueue("a");
    await q.flush(1000);
    q.enqueue("b");
    await q.flush(1000);
    assert.equal(client.sent.length, 1);
    assert.equal(q.getStats().disabled, "401 Unauthorized");
    const errors = lines.filter((l) => l.level === "error");
    assert.equal(errors.length, 1);
    assert.match(JSON.stringify(errors[0]!.obj), /BotFather/);
  });

  test("a migrated group is followed without losing the alert", async () => {
    const client = fakeClient([{ kind: "migrated", chatId: "-100777" }]);
    const { q } = queue(client, { maxAttempts: 1 });
    q.enqueue("a");
    await q.flush(1000);
    assert.equal(client.sent.length, 2);
    assert.equal(q.getStats().sent, 1);
  });

  test("a full backlog drops the oldest normal alerts, never a critical one, and says so", async () => {
    const client = fakeClient();
    client.hold();
    const { q } = queue(client, { maxQueued: 3 });
    q.enqueue("in flight");
    await new Promise((r) => setImmediate(r));
    q.enqueue("HALT", "critical");
    q.enqueue("n1");
    q.enqueue("n2");
    q.enqueue("n3"); // over the cap: n1 goes
    q.enqueue("n4"); // over the cap: n2 goes
    client.release();
    await q.flush(1000);
    const next = client.sent[1]!.text;
    assert.match(next, /^⚠️ 2 earlier alerts were dropped/);
    assert.ok(next.includes("HALT") && next.includes("n3") && next.includes("n4"));
    assert.ok(!next.includes("n1") && !next.includes("n2"));
    assert.equal(q.getStats().dropped, 2);
  });

  test("sends are spaced by minIntervalMs", async () => {
    let now = 1_000_000;
    const client = fakeClient();
    client.hold();
    const { q, sleeps } = queue(client, {
      minIntervalMs: 1100,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    q.enqueue("a");
    await new Promise((r) => setImmediate(r));
    q.enqueue("b");
    now += 300; // the first send took 300ms
    client.release();
    await q.flush(1000);
    assert.deepEqual(sleeps, [1100]);
  });

  test("flush reports a timeout instead of hanging shutdown", async () => {
    const client = fakeClient();
    client.hold();
    const { q } = queue(client);
    q.enqueue("stuck");
    // flush's timer is unref'd (it must not hold a dying engine open), so keep
    // the test process alive with a ref'd one while it runs.
    const [flushed] = await Promise.all([q.flush(20), new Promise((r) => setTimeout(r, 50))]);
    assert.equal(flushed, false);
    client.release();
    assert.equal(await q.flush(1000), true);
  });
});

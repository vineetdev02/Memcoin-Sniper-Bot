import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BotSwitch, type SwitchParts } from "./bot-switch.js";

function makeSwitch(opts: { startFails?: boolean } = {}) {
  const calls: string[] = [];
  let live = false;
  const parts: SwitchParts = {
    feed: {
      start: async () => {
        calls.push("feed.start");
        await new Promise((r) => setTimeout(r, 5));
        if (opts.startFails) throw new Error("ws refused");
        live = true;
      },
      stop: async () => {
        calls.push("feed.stop");
        live = false;
      },
      isLive: () => live,
    },
    detector: { clearPending: () => calls.push("detector.clear") },
    orchestrator: { setLive: (on) => calls.push(`orchestrator.${on}`) },
    trader: { setEnabled: (on) => calls.push(`trader.${on}`) },
  };
  return { bot: new BotSwitch(parts), calls };
}

describe("bot switch", () => {
  test("a fresh engine is off and has touched nothing", () => {
    const { bot, calls } = makeSwitch();
    assert.equal(bot.isOn(), false);
    assert.equal(bot.feedLive(), false);
    assert.deepEqual(calls, []);
  });

  test("on subscribes before it trades", async () => {
    const { bot, calls } = makeSwitch();
    await bot.set(true);
    assert.equal(bot.isOn(), true);
    assert.deepEqual(calls, ["orchestrator.true", "feed.start", "trader.true"]);
  });

  test("off stops trading first, then unsubscribes and drops queued parses", async () => {
    const { bot, calls } = makeSwitch();
    await bot.set(true);
    calls.length = 0;
    await bot.set(false);
    assert.equal(bot.isOn(), false);
    assert.deepEqual(calls, ["trader.false", "orchestrator.false", "feed.stop", "detector.clear"]);
  });

  test("a double click subscribes once", async () => {
    const { bot, calls } = makeSwitch();
    await Promise.all([bot.set(true), bot.set(true)]);
    assert.equal(calls.filter((c) => c === "feed.start").length, 1);
  });

  test("a feed that will not start leaves the bot off and the filters idle", async () => {
    const { bot, calls } = makeSwitch({ startFails: true });
    await assert.rejects(bot.set(true), /ws refused/);
    assert.equal(bot.isOn(), false);
    assert.deepEqual(calls, ["orchestrator.true", "feed.start", "orchestrator.false"]);
    // and the switch still works afterwards
    await bot.set(false);
    assert.equal(bot.isOn(), false);
  });
});

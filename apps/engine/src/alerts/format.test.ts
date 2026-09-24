import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fmt from "./format.js";
import { MINT, makePosition } from "./test-fixtures.js";

describe("escaping", () => {
  test("escapes the characters Telegram's HTML mode parses", () => {
    assert.equal(fmt.escapeHtml(`<b>"A" & B</b>`), "&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;");
  });

  test("a token named with markup cannot inject markup into the alert", () => {
    const msg = fmt.positionOpened(makePosition({ tokenSymbol: "<b>RUG</b> & co" }), "paper");
    assert.ok(msg.includes("&lt;b&gt;RUG&lt;/b&gt; &amp; co"));
    assert.ok(!msg.includes("<b>RUG</b>"));
  });

  test("htmlToPlain undoes our own markup and keeps link targets", () => {
    const plain = fmt.htmlToPlain(`<b>A &amp; B</b> <a href="https://x.test/1">chart</a> &lt;3`);
    assert.equal(plain, "A & B chart (https://x.test/1) <3");
  });
});

describe("tokenLabel", () => {
  test("strips bidi overrides and zero-width characters used to spoof tickers", () => {
    assert.equal(fmt.tokenLabel("‮KNOB​", MINT), "KNOB");
  });

  test("falls back to the short mint when the symbol is empty or invisible", () => {
    assert.equal(fmt.tokenLabel(undefined, MINT), "7xKX…gAsU");
    assert.equal(fmt.tokenLabel("  ​ ", MINT), "7xKX…gAsU");
  });

  test("truncates by code point, so an emoji is never split", () => {
    const label = fmt.tokenLabel("🐸".repeat(40), MINT);
    assert.equal(Array.from(label).length, 32);
    assert.ok(label.endsWith("🐸…"));
    assert.ok(!label.includes("�"));
  });
});

describe("numbers", () => {
  test("usd and signed forms", () => {
    assert.equal(fmt.usd(1234.5), "$1,234.50");
    assert.equal(fmt.usd(-12), "-$12.00");
    assert.equal(fmt.signedUsd(5), "+$5.00");
    assert.equal(fmt.signedUsd(-5), "-$5.00");
    assert.equal(fmt.signedPct(-40), "-40.0%");
    assert.equal(fmt.signedUsd(Number.NaN), "n/a");
  });

  test("price picks a readable form across magnitudes", () => {
    assert.equal(fmt.price(2.5), "$2.50");
    assert.equal(fmt.price(0.001234), "$0.001234");
    assert.equal(fmt.price(0.00000001234), "$1.234e-8");
    assert.equal(fmt.price(0), "n/a");
  });

  test("duration", () => {
    assert.equal(fmt.duration(45_000), "45s");
    assert.equal(fmt.duration(12 * 60_000), "12m");
    assert.equal(fmt.duration(185 * 60_000), "3h 5m");
    assert.equal(fmt.duration(52 * 3_600_000), "2d 4h");
  });
});

describe("messages", () => {
  test("every message says which mode it came from", () => {
    assert.ok(fmt.positionOpened(makePosition(), "paper").includes("[PAPER]"));
    assert.ok(fmt.positionOpened(makePosition(), "live").includes("LIVE"));
  });

  test("a winning exit, a losing exit and a rug read differently", () => {
    const closedAt = makePosition().openedAt + 12 * 60_000;
    const win = fmt.positionClosed(makePosition({ realizedPnlUsd: 80.1, closeReason: "tp3", closedAt }), "paper");
    const loss = fmt.positionClosed(makePosition({ realizedPnlUsd: -40, closeReason: "stop-loss", closedAt }), "paper");
    const rug = fmt.positionClosed(makePosition({ realizedPnlUsd: -95, closeReason: "rug-pull", closedAt }), "paper");
    assert.ok(win.startsWith("✅") && win.includes("+$80.10") && win.includes("(+80.1%)") && win.includes("held 12m"));
    assert.ok(loss.startsWith("🔻") && loss.includes("stop-loss"));
    assert.ok(rug.startsWith("🚨") && rug.includes("RUG"));
  });

  test("engine stopping warns about positions left unmanaged", () => {
    assert.ok(fmt.engineStopping("SIGTERM", 3, "paper").includes("3 open positions are no longer being managed"));
    assert.ok(fmt.engineStopping("SIGINT", 1, "paper").includes("1 open position is"));
    assert.ok(fmt.engineStopping("SIGINT", 0, "paper").includes("No open positions"));
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatUsd } from "./format.js";

describe("formatUsd", () => {
  test("rounds a loss to cents and puts the sign before the $", () => {
    assert.equal(formatUsd(-47.534674), "-$47.53");
    assert.equal(formatUsd(47.534674), "$47.53");
  });

  test("keeps sub-dollar precision for small amounts of either sign", () => {
    assert.equal(formatUsd(0.534674), "$0.534674");
    assert.equal(formatUsd(-0.534674), "-$0.534674");
  });

  test("compacts large losses the same way as large gains", () => {
    assert.equal(formatUsd(12_345, { compact: true }), "$12.3K");
    assert.equal(formatUsd(-12_345, { compact: true }), "-$12.3K");
    assert.equal(formatUsd(-999, { compact: true }), "-$999");
  });

  test("never shows a negative zero", () => {
    assert.equal(formatUsd(-0), "$0");
    assert.equal(formatUsd(-0.0000001), "$0");
  });

  test("shows a dash for a number it cannot format", () => {
    assert.equal(formatUsd(Number.NaN), "—");
    assert.equal(formatUsd(-Infinity), "—");
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { launchFarmReason } from "./dev-wallet.js";

describe("dev-wallet launch farms", () => {
  test("a creator at the limit fails, one under it does not", () => {
    assert.equal(launchFarmReason(2, 3), null);
    assert.match(launchFarmReason(3, 3)!, /launched 3 other coins in the last 24 h \(max 2\)/);
    assert.ok(launchFarmReason(40, 3));
  });

  test("a limit of 0 turns the check off", () => {
    assert.equal(launchFarmReason(500, 0), null);
  });
});

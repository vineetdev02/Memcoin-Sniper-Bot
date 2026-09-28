import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_TARGETS } from "./program-ids.js";

const raydium = PROGRAM_TARGETS.find((t) => t.source === "raydium-amm")!;
const isCreation = (logs: string[]) =>
  raydium.creationMarkers.some((m) => logs.some((line) => line.includes(m)));

describe("raydium-amm creation markers", () => {
  test("a swap on an existing pool is not a new pool", () => {
    // the logs of a real swap the engine once stored as a pool creation
    assert.equal(isCreation(["Program log: ray_log: A6ltDwAAAAAAD9EBAAAAAAABAAAAAAAAAP96"]), false);
  });

  test("initialize2 is", () => {
    assert.equal(
      isCreation([
        "Program log: initialize2: InitializeInstruction2 { nonce: 254, open_time: 0 }",
        "Program log: ray_log: AAAA",
      ]),
      true,
    );
  });
});

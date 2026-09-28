import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { limitRpcRate, meteredFetch, rpcUsage } from "./rpc-meter.js";

describe("rpc meter", () => {
  test("counts every request and paces them to the per-second cap", async () => {
    const realFetch = globalThis.fetch;
    const sentAt: number[] = [];
    globalThis.fetch = (async () => {
      sentAt.push(Date.now());
      return new Response("{}");
    }) as typeof fetch;
    try {
      limitRpcRate(2);
      const before = rpcUsage().rpcRequests;
      const t0 = Date.now();
      await Promise.all(Array.from({ length: 5 }, () => meteredFetch("https://rpc.test")));
      assert.equal(rpcUsage().rpcRequests - before, 5);
      // 2 per second: requests 3–4 wait for the second window, request 5 for the third
      assert.ok((sentAt[2] ?? 0) - t0 >= 900, `3rd request went out after ${(sentAt[2] ?? 0) - t0}ms`);
      assert.ok((sentAt[4] ?? 0) - t0 >= 1900, `5th request went out after ${(sentAt[4] ?? 0) - t0}ms`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

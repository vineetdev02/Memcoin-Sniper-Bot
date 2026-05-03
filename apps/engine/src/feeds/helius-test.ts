import { Connection } from "@solana/web3.js";
import WebSocket from "ws";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("helius-test");

interface TestResult {
  rpcOk: boolean;
  rpcSlot?: number;
  rpcVersion?: string;
  rpcLatencyMs?: number;
  wsOk: boolean;
  wsLatencyMs?: number;
  errors: string[];
}

async function testRpc(): Promise<Pick<TestResult, "rpcOk" | "rpcSlot" | "rpcVersion" | "rpcLatencyMs" | "errors">> {
  const errors: string[] = [];
  if (!env.HELIUS_API_KEY) {
    errors.push("HELIUS_API_KEY is empty — cannot test RPC");
    return { rpcOk: false, errors };
  }

  const url = env.HELIUS_RPC_URL.endsWith("=")
    ? `${env.HELIUS_RPC_URL}${env.HELIUS_API_KEY}`
    : env.HELIUS_RPC_URL;

  try {
    const conn = new Connection(url, "confirmed");
    const start = Date.now();
    const [slot, version] = await Promise.all([conn.getSlot(), conn.getVersion()]);
    const rpcLatencyMs = Date.now() - start;
    return {
      rpcOk: true,
      rpcSlot: slot,
      rpcVersion: version["solana-core"],
      rpcLatencyMs,
      errors,
    };
  } catch (err) {
    errors.push(`RPC error: ${(err as Error).message}`);
    return { rpcOk: false, errors };
  }
}

async function testWs(): Promise<Pick<TestResult, "wsOk" | "wsLatencyMs" | "errors">> {
  const errors: string[] = [];
  if (!env.HELIUS_API_KEY) {
    errors.push("HELIUS_API_KEY is empty — cannot test WS");
    return { wsOk: false, errors };
  }

  const url = env.HELIUS_WS_URL.endsWith("=")
    ? `${env.HELIUS_WS_URL}${env.HELIUS_API_KEY}`
    : env.HELIUS_WS_URL;

  return new Promise((resolve) => {
    const start = Date.now();
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      errors.push("WS connection timeout (5s)");
      ws.terminate();
      resolve({ wsOk: false, errors });
    }, 5000);

    ws.once("open", () => {
      const wsLatencyMs = Date.now() - start;
      clearTimeout(timeout);

      const subscribePayload = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "slotSubscribe",
      });
      ws.send(subscribePayload);

      const slotTimeout = setTimeout(() => {
        ws.close();
        resolve({ wsOk: true, wsLatencyMs, errors });
      }, 1500);

      ws.on("message", (data) => {
        const msg = data.toString();
        if (msg.includes("slotNotification") || msg.includes('"result"')) {
          clearTimeout(slotTimeout);
          ws.close();
          resolve({ wsOk: true, wsLatencyMs, errors });
        }
      });
    });

    ws.once("error", (err) => {
      clearTimeout(timeout);
      errors.push(`WS error: ${err.message}`);
      resolve({ wsOk: false, errors });
    });
  });
}

export async function testHeliusConnection(): Promise<TestResult> {
  log.info("Testing Helius connectivity...");
  const [rpc, ws] = await Promise.all([testRpc(), testWs()]);
  const result: TestResult = {
    ...rpc,
    ...ws,
    errors: [...rpc.errors, ...ws.errors],
  };

  if (result.rpcOk) {
    log.info(
      { slot: result.rpcSlot, version: result.rpcVersion, latencyMs: result.rpcLatencyMs },
      "RPC OK",
    );
  } else {
    log.error({ errors: rpc.errors }, "RPC FAILED");
  }

  if (result.wsOk) {
    log.info({ latencyMs: result.wsLatencyMs }, "WS OK");
  } else {
    log.error({ errors: ws.errors }, "WS FAILED");
  }

  return result;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  testHeliusConnection()
    .then((r) => {
      const ok = r.rpcOk && r.wsOk;
      log.info({ ok }, ok ? "All Helius checks passed" : "Some Helius checks failed");
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      log.fatal({ err }, "Helius test crashed");
      process.exit(1);
    });
}

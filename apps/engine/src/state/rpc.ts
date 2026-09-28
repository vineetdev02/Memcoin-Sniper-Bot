import { Connection } from "@solana/web3.js";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { meteredFetch } from "../utils/rpc-meter.js";

const log = childLogger("rpc");

let connection: Connection | null = null;

export function getRpcConnection(): Connection {
  if (connection) return connection;

  let rpcUrl: string;
  const urlNeedsKey = env.HELIUS_RPC_URL.endsWith("=");
  const urlIsSelfAuth = !urlNeedsKey && env.HELIUS_RPC_URL.length > 0;
  if (urlNeedsKey && env.HELIUS_API_KEY) {
    rpcUrl = `${env.HELIUS_RPC_URL}${env.HELIUS_API_KEY}`;
    log.info({ provider: "helius" }, "RPC connection configured");
  } else if (urlIsSelfAuth) {
    rpcUrl = env.HELIUS_RPC_URL;
    const host = (() => {
      try {
        return new URL(rpcUrl).hostname;
      } catch {
        return "custom";
      }
    })();
    log.info({ provider: host }, "RPC connection configured (self-auth URL)");
  } else {
    rpcUrl = env.PUBLIC_SOLANA_RPC;
    log.warn(
      { url: rpcUrl },
      "Using public Solana RPC fallback — rate limits will hurt; add a real RPC URL for production",
    );
  }

  connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 30_000,
    fetch: meteredFetch,
  });
  return connection;
}

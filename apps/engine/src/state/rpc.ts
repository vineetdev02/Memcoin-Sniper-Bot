import { Connection } from "@solana/web3.js";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("rpc");

let connection: Connection | null = null;

export function getRpcConnection(): Connection {
  if (connection) return connection;

  let rpcUrl: string;
  if (env.HELIUS_API_KEY) {
    rpcUrl = env.HELIUS_RPC_URL.endsWith("=")
      ? `${env.HELIUS_RPC_URL}${env.HELIUS_API_KEY}`
      : env.HELIUS_RPC_URL;
    log.info({ provider: "helius" }, "RPC connection configured");
  } else {
    rpcUrl = env.PUBLIC_SOLANA_RPC;
    log.warn(
      { url: rpcUrl },
      "Using public Solana RPC fallback — rate limits will hurt; add HELIUS_API_KEY for production",
    );
  }

  connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 30_000,
  });
  return connection;
}

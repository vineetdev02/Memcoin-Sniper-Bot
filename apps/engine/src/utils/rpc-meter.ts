import PQueue from "p-queue";

/**
 * Every JSON-RPC request the engine sends goes through here, so this is where
 * it is counted and where it is paced.
 *
 * Counted, so the spend is on the dashboard instead of guessed: Helius bills
 * per request, so `rpcRequests` is roughly the credit count, and
 * `logNotifications` is every log the WebSocket stream delivered, most of
 * which are trades the detector throws away.
 *
 * Paced, because the filters fire their calls in parallel: past the plan's
 * per-second limit Helius answers 429, the filter reports an error, and the
 * request was wasted. Queued requests just wait their turn instead.
 */
let rpcRequests = 0;
let logNotifications = 0;
let limiter: PQueue | null = null;

export function limitRpcRate(maxPerSecond: number): void {
  limiter = new PQueue({ intervalCap: maxPerSecond, interval: 1000 });
}

export const meteredFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const send = () => {
    rpcRequests++;
    return fetch(input, init);
  };
  return limiter ? limiter.add(send) : send();
}) as typeof fetch;

export function countLogNotification(): void {
  logNotifications++;
}

export function rpcUsage(): { rpcRequests: number; logNotifications: number } {
  return { rpcRequests, logNotifications };
}

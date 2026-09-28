/**
 * Counts what the engine asks of its RPC provider, so the spend is on the
 * dashboard instead of guessed. Helius bills per request, so `rpcRequests` is
 * roughly the credit count; `logNotifications` is every log the WebSocket
 * stream delivered, most of which are trades the detector throws away.
 */
let rpcRequests = 0;
let logNotifications = 0;

export const meteredFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  rpcRequests++;
  return fetch(input, init);
}) as typeof fetch;

export function countLogNotification(): void {
  logNotifications++;
}

export function rpcUsage(): { rpcRequests: number; logNotifications: number } {
  return { rpcRequests, logNotifications };
}

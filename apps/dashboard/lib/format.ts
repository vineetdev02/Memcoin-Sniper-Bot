export function shortAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** A loss reads `-$47.53`: the sign goes before the `$`, and size is judged on the magnitude. */
export function formatUsd(value: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (opts.compact && abs >= 1000) {
    return `${sign}$${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(abs)}`;
  }
  const digits = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: abs < 1 ? 6 : 2,
  }).format(abs);
  // A loss too small to show at 6 decimals is not a loss worth a minus sign.
  return digits === "0" ? "$0" : `${sign}$${digits}`;
}

export function formatPriceUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1e-6) return `$${value.toExponential(3)}`;
  if (value < 0.01) return `$${value.toFixed(8)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

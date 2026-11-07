/** Pure display helpers. Money is handled as bigint base units, never floats. */

export const EXPLORER = "https://explorer.testnet.whitechain.io";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

/** 0x71c9d8f03a… -> 0x71c9…d03a */
export function shortAddress(a: string, head = 6, tail = 4): string {
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** USDT base units (6 dp, decimal string or bigint) -> "8,420.00". Truncates, never rounds up. */
export function formatUsdt(base: string | bigint, decimals = 2): string {
  let v: bigint;
  try {
    v = typeof base === "bigint" ? base : BigInt(base);
  } catch {
    return "—";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const scale = 10n ** 6n;
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(6, "0").slice(0, decimals);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${decimals ? "." + frac : ""}`;
}

/** basis points -> "18%" / "12.5%" */
export function bpsToPercent(bps: number): string {
  const p = bps / 100;
  return `${Number.isInteger(p) ? p : p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** seconds until `endsAt` -> "2d 14h", "18h 09m", "5m", or "ended" */
export function timeLeft(endsAt: number, now = Math.floor(Date.now() / 1000)): string {
  const s = endsAt - now;
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${Math.max(m, 1)}m`;
}

/** unix seconds -> "2m ago", "3h ago", "yesterday", "5d ago" */
export function ago(unix: number, now = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, now - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  return `${Math.floor(s / 86400)}d ago`;
}

/** CSV of verified sales for the creator's own records. Fields are quoted only when they need it. */
export function salesToCsv(
  sales: { txHash: string; campaignId: string; gross: string; commission: string; status: string; paidAt: number }[],
): string {
  const needsQuotes = /[",\n\r]/;
  const cell = (v: string | number) => {
    const s = String(v);
    return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["txHash", "campaignId", "grossUsdt", "commissionUsdt", "status", "paidAtUtc"];
  const rows = sales.map((x) => [
    x.txHash,
    x.campaignId,
    formatUsdt(x.gross, 6),
    formatUsdt(x.commission, 6),
    x.status,
    new Date(x.paidAt * 1000).toISOString(),
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

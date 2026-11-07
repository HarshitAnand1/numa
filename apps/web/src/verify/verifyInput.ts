/** What a pasted string on the verify page is. Both an order id and a tx hash are 0x + 64 hex, so they're tried in turn. */
export type VerifyInput = { kind: "hash"; value: `0x${string}` } | { kind: "bad"; reason: string };

export function parseVerifyInput(raw: string): VerifyInput {
  const v = raw.trim();
  if (!v) return { kind: "bad", reason: "Paste an order id or a transaction hash." };
  if (/^NMA-\d+$/i.test(v)) return { kind: "bad", reason: "Short ids like NMA-1234 are demo labels. Paste the 0x… order id (64 hex characters) or the transaction hash." };
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) return { kind: "bad", reason: "That isn't an order id or transaction hash: it should be 0x followed by 64 hex characters." };
  return { kind: "hash", value: v.toLowerCase() as `0x${string}` };
}

const STATUS: Record<string, string> = {
  held: "Paid. The creator's commission is held until the refund window ends.",
  released: "Paid and settled. The commission has been released to the creator.",
  partially_refunded: "Partly refunded. Only the unrefunded share of the commission is still held.",
  refunded: "Fully refunded.",
};
export const statusText = (s: string) => STATUS[s] ?? `Status: ${s}`;

/** "25.000000" -> "25.00" (truncates; never rounds a decimal string up). */
export const usdt2 = (s: string) => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  return m ? `${m[1]}.${(m[2] ?? "").padEnd(2, "0").slice(0, 2)}` : "—";
};

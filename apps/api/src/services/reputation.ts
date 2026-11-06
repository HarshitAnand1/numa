import type { VerifiedConversion } from "./verify.js";

export interface ReputationInput extends Pick<VerifiedConversion, "gross" | "commission" | "buyer"> {
  /** Fully refunded orders do not count. */
  refunded?: boolean;
}

export interface Reputation {
  verifiedConversions: number;
  distinctPayers: number;
  grossSettled: bigint; // USDT base units (6 dp)
  commissionEarned: bigint;
  /** 0-100, or null when there is no verified history. */
  score: number | null;
  label: string;
}

const USDT = 1_000_000;

/**
 * score = 100 * (0.5*G + 0.5*N) * (0.5 + 0.5*D)
 *   G = 1 - exp(-grossUSDT / 1000)          gross settled sales (saturating)
 *   N = 1 - exp(-distinctPayers / 10)       breadth of payers (saturating)
 *   D = distinctPayers / verifiedConversions concentration penalty (repeat payers)
 * Counts only conversions verified against OrderSettled. It does NOT prove audience
 * authenticity: sybil wallets and self-purchases from other wallets still score.
 */
export function computeReputation(rows: ReputationInput[]): Reputation {
  const live = rows.filter((r) => !r.refunded);
  if (live.length === 0) {
    return { verifiedConversions: 0, distinctPayers: 0, grossSettled: 0n, commissionEarned: 0n, score: null, label: "No verified sales history yet." };
  }
  const payers = new Set(live.map((r) => r.buyer.toLowerCase()));
  const gross = live.reduce((s, r) => s + r.gross, 0n);
  const commission = live.reduce((s, r) => s + r.commission, 0n);
  const G = 1 - Math.exp(-(Number(gross) / USDT) / 1000);
  const N = 1 - Math.exp(-payers.size / 10);
  const D = payers.size / live.length;
  const score = Math.round(100 * (0.5 * G + 0.5 * N) * (0.5 + 0.5 * D));
  return { verifiedConversions: live.length, distinctPayers: payers.size, grossSettled: gross, commissionEarned: commission, score, label: `${live.length} verified sale(s)` };
}

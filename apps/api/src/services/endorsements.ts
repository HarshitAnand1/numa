import type { Address, Hex, PublicClient } from "viem";
import { findSettled, type SettledCache } from "./verify.js";

export interface EndorsementClaim {
  merchant: Address; // Arkiv entity owner (the claimed author)
  creator: Address; campaignId: bigint; orderId: Hex; txHash: Hex; rating: number; note: string; entityKey: Hex;
}
export interface EndorsementSummary { count: number; averageRating: number | null; distinctMerchants: number }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An endorsement counts only if the tx has an OrderSettled for `orderId` where the endorsing wallet is that
 * order's merchant and the creator/campaign match. This stops anyone endorsing (or smearing) a creator
 * they never sold through. Collusion between a merchant and a creator is NOT prevented.
 */
export async function verifyEndorsement(pub: PublicClient, router: Address, c: EndorsementClaim, cache?: SettledCache): Promise<{ ok: true } | { ok: false; reason: string }> {
  const f = await findSettled(pub, router, c.txHash, c.orderId, cache);
  if (!f.ok) return f;
  if (!same(f.value.merchant, c.merchant)) return { ok: false, reason: "author is not the order's merchant" };
  if (!same(f.value.creator, c.creator)) return { ok: false, reason: "creator mismatch" };
  if (f.value.campaignId !== c.campaignId) return { ok: false, reason: "campaign mismatch" };
  return { ok: true };
}

/** One endorsement per order (first by entityKey wins, deterministic); returns the verified ones plus rejections. */
export async function verifiedEndorsements(pub: PublicClient, router: Address, claims: EndorsementClaim[], cache?: SettledCache) {
  const seen = new Set<string>();
  const accepted: EndorsementClaim[] = [];
  const rejected: { entityKey: Hex; reason: string }[] = [];
  for (const c of [...claims].sort((a, b) => a.entityKey.localeCompare(b.entityKey))) {
    if (seen.has(c.orderId.toLowerCase())) { rejected.push({ entityKey: c.entityKey, reason: "duplicate endorsement for order" }); continue; }
    const v = await verifyEndorsement(pub, router, c, cache);
    if (v.ok) { seen.add(c.orderId.toLowerCase()); accepted.push(c); } else rejected.push({ entityKey: c.entityKey, reason: v.reason });
  }
  return { accepted, rejected };
}

export function summarizeEndorsements(accepted: Pick<EndorsementClaim, "rating" | "merchant">[]): EndorsementSummary {
  if (accepted.length === 0) return { count: 0, averageRating: null, distinctMerchants: 0 };
  const avg = accepted.reduce((s, e) => s + e.rating, 0) / accepted.length;
  return { count: accepted.length, averageRating: Math.round(avg * 10) / 10, distinctMerchants: new Set(accepted.map((e) => e.merchant.toLowerCase())).size };
}

import type { Address, PublicClient } from "viem";
import { listConversions, type ArkivReader } from "@numa/arkiv";
import { computeReputation, type Reputation } from "./reputation.js";
import { verifyConversion } from "./verify.js";

/**
 * Reputation for a creator: read their conversions (owned by the Numa writer wallet) from Arkiv,
 * keep only those that verify against the router's OrderSettled event, then score.
 */
export async function creatorReputation(
  deps: { arkiv: ArkivReader; pub: PublicClient; router: Address; writer: Address },
  creator: Address,
): Promise<{ reputation: Reputation; rejected: { txHash: string; reason: string }[] }> {
  const claims = await listConversions(deps.arkiv, { creator, writer: deps.writer, limit: 100 });
  const rows = [];
  const rejected: { txHash: string; reason: string }[] = [];
  for (const c of claims) {
    const v = await verifyConversion(deps.pub, deps.router, { ...c, creator: c.creator as Address, merchant: c.merchant as Address });
    if (v.ok) rows.push({ gross: v.value.gross, commission: v.value.commission, buyer: v.value.buyer, refunded: c.status === "refunded" });
    else rejected.push({ txHash: c.txHash, reason: v.reason });
  }
  return { reputation: computeReputation(rows), rejected };
}

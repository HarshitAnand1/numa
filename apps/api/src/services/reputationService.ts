import type { Address, Hex, PublicClient } from "viem";
import { listConversions, type ArkivReader } from "@numa/arkiv";
import { computeReputation, type Reputation } from "./reputation.js";
import { verifyConversion, type SettledCache, type VerifiedConversion } from "./verify.js";

export interface ReputationDeps { arkiv: ArkivReader; pub: PublicClient; router: Address; writer: Address; cache?: SettledCache }

/** Verify a batch of Arkiv conversion claims against chain; returns verified rows (with status) and rejections. */
export async function verifyClaims(
  deps: Pick<ReputationDeps, "pub" | "router" | "cache">,
  claims: { creator: string; merchant: string; campaignId: bigint; gross: bigint; commission: bigint; txHash: Hex; orderId: Hex; status: string; paidAt: number }[],
) {
  const verified: (VerifiedConversion & { status: string; paidAt: number })[] = [];
  const rejected: { txHash: string; reason: string }[] = [];
  for (const c of claims) {
    const v = await verifyConversion(deps.pub, deps.router, { ...c, creator: c.creator as Address, merchant: c.merchant as Address }, deps.cache);
    if (v.ok) verified.push({ ...v.value, status: c.status, paidAt: c.paidAt }); else rejected.push({ txHash: c.txHash, reason: v.reason });
  }
  return { verified, rejected };
}

/**
 * Reputation for a creator: read their conversions (owned by the Numa writer wallet) from Arkiv,
 * keep only those that verify against the router's OrderSettled event, then score.
 */
export async function creatorReputation(deps: ReputationDeps, creator: Address): Promise<{ reputation: Reputation; verified: Awaited<ReturnType<typeof verifyClaims>>["verified"]; rejected: { txHash: string; reason: string }[] }> {
  const claims = await listConversions(deps.arkiv, { creator, writer: deps.writer, limit: 100 });
  const { verified, rejected } = await verifyClaims(deps, claims);
  const reputation = computeReputation(verified.map((v) => ({ gross: v.gross, commission: v.commission, buyer: v.buyer, refunded: v.status === "refunded" })));
  return { reputation, verified, rejected };
}

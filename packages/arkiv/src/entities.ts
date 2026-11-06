import { and, eq, gte, lte, type Expression } from "@arkiv-network/sdk/query";
import { addr, key as keyVal, u64, u256 } from "@arkiv-network/sdk/schema";
import type { Address, Hex } from "viem";
import type { ArkivReader, ArkivWriter } from "./client.js";
import { expiries } from "./expiry.js";
import { CampaignSchema, ConversionSchema, DecisionSchema, LinkSchema, OfferSchema } from "./schemas.js";

export interface PublishResult { entityKey: Hex; txHash: Hex }

// ---------- writes (each is signed by the entity's owner) ----------

/** Merchant wallet. */
export async function publishCampaign(
  w: ArkivWriter,
  c: { campaignId: bigint; status: "active" | "paused" | "ended"; category: string; commissionBps: number; endsAt: number; region: string; name: string; description: string },
): Promise<PublishResult> {
  return w.createEntity(
    CampaignSchema,
    { campaignId: u64(c.campaignId), status: c.status, category: c.category, commissionBps: u64(BigInt(c.commissionBps)), endsAt: u64(BigInt(c.endsAt)), region: c.region, name: c.name, description: c.description },
    { expiration: expiries.campaign(c.endsAt) },
  );
}

/** Creator wallet. */
export async function publishOffer(
  w: ArkivWriter,
  o: { campaignId: bigint; channel: string; audience: string; askBps: number; expectedReach: bigint },
): Promise<PublishResult> {
  return w.createEntity(
    OfferSchema,
    { campaignId: u64(o.campaignId), channel: o.channel, audience: o.audience, askBps: u64(BigInt(o.askBps)), expectedReach: u64(o.expectedReach) },
    { expiration: expiries.offer() },
  );
}

/** Merchant wallet. */
export async function publishDecision(
  w: ArkivWriter,
  d: { offerKey: Hex; campaignId: bigint; result: "approved" | "rejected"; approveTx?: Hex; campaignEndsAt: number },
): Promise<PublishResult> {
  return w.createEntity(
    DecisionSchema,
    { offerKey: keyVal(d.offerKey), campaignId: u64(d.campaignId), result: d.result, approveTx: d.approveTx ?? "" },
    { expiration: expiries.decision(d.campaignEndsAt) },
  );
}

/** Creator wallet. */
export async function publishLink(w: ArkivWriter, l: { code: string; campaignId: bigint; days: number }): Promise<PublishResult> {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(l.code)) throw new Error("link code must be 4-32 chars [A-Za-z0-9_-]");
  return w.createEntity(LinkSchema, { code: l.code, campaignId: u64(l.campaignId) }, { expiration: expiries.link(l.days) });
}

/** Numa writer wallet only. Caller must have verified the OrderSettled event for txHash first. */
export async function publishConversion(
  w: ArkivWriter,
  c: { creator: Address; merchant: Address; campaignId: bigint; gross: bigint; commission: bigint; status: ConversionStatus; paidAt: number; txHash: Hex; orderId: Hex },
): Promise<PublishResult> {
  return w.createEntity(
    ConversionSchema,
    { creator: addr(c.creator), merchant: addr(c.merchant), campaignId: u64(c.campaignId), gross: u256(c.gross), commission: u256(c.commission), status: c.status, paidAt: u64(BigInt(c.paidAt)), txHash: c.txHash, orderId: c.orderId },
    { expiration: expiries.conversion() },
  );
}

export type ConversionStatus = "held" | "released" | "refunded" | "partially_refunded";

// ---------- reads ----------

export interface CampaignFilter { category?: string; region?: string; minCommissionBps?: number; maxCommissionBps?: number; endsAfter?: number; limit?: number; offset?: number }

/** Active, not-yet-ended campaigns for discovery. */
export async function listCampaigns(r: ArkivReader, f: CampaignFilter = {}, now = Math.floor(Date.now() / 1000)) {
  const preds: Expression[] = [eq("status", "active"), gte("endsAt", u64(BigInt(f.endsAfter ?? now)))];
  if (f.category) preds.push(eq("category", f.category));
  if (f.region) preds.push(eq("region", f.region));
  if (f.minCommissionBps !== undefined) preds.push(gte("commissionBps", u64(BigInt(f.minCommissionBps))));
  if (f.maxCommissionBps !== undefined) preds.push(lte("commissionBps", u64(BigInt(f.maxCommissionBps))));
  const res = await r.select().from(CampaignSchema).where(and(...preds) as never /* dynamic filter; all names are CampaignSchema columns */).limit(f.limit ?? 50).offset(f.offset ?? 0).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, merchant: e.$owner, campaignId: e.campaignId.value, status: e.status.value, category: e.category.value,
    commissionBps: Number(e.commissionBps.value), endsAt: Number(e.endsAt.value), region: e.region.value, name: e.name.value, description: e.description.value,
  }));
}

export async function listOffers(r: ArkivReader, campaignId: bigint, limit = 50) {
  const res = await r.select().from(OfferSchema).where(eq("campaignId", u64(campaignId))).limit(limit).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, creator: e.$owner, campaignId: e.campaignId.value, channel: e.channel.value, audience: e.audience.value,
    askBps: Number(e.askBps.value), expectedReach: e.expectedReach.value,
  }));
}

/**
 * Decisions for a campaign, accepted ONLY if authored by the campaign's merchant wallet.
 * Anyone can write an entity with this schema, so ownership must be checked.
 */
export async function listDecisions(r: ArkivReader, campaignId: bigint, merchant: Address) {
  const res = await r.select().from(DecisionSchema).where(eq("campaignId", u64(campaignId))).ownedBy(merchant).limit(100).fetch();
  return res.entities.map((e) => ({ entityKey: e.$key, merchant: e.$owner, offerKey: e.offerKey.value, result: e.result.value, approveTx: e.approveTx.value }));
}

/**
 * Resolve an attribution link. Trusted only if owned by `expectedCreator`;
 * returns undefined otherwise (nobody else can claim a creator's link).
 */
export async function resolveLink(r: ArkivReader, p: { code: string; campaignId: bigint; expectedCreator: Address }) {
  const res = await r.select().from(LinkSchema).where(and(eq("code", p.code), eq("campaignId", u64(p.campaignId)))).ownedBy(p.expectedCreator).limit(1).fetch();
  const e = res.entities[0];
  return e ? { entityKey: e.$key, creator: e.$owner, code: e.code.value, campaignId: e.campaignId.value } : undefined;
}

/** Conversions for a creator, accepted only from the Numa writer wallet. */
export async function listConversions(r: ArkivReader, p: { creator: Address; writer: Address; limit?: number; offset?: number }) {
  const res = await r.select().from(ConversionSchema).where(eq("creator", addr(p.creator))).ownedBy(p.writer).limit(p.limit ?? 100).offset(p.offset ?? 0).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, creator: e.creator.value, merchant: e.merchant.value, campaignId: e.campaignId.value, gross: e.gross.value,
    commission: e.commission.value, status: e.status.value as ConversionStatus, paidAt: Number(e.paidAt.value), txHash: e.txHash.value as Hex, orderId: e.orderId.value as Hex,
  }));
}

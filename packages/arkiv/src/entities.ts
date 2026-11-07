import { and, asc, desc, eq, gte, lte, type Expression } from "@arkiv-network/sdk/query";
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

export interface CampaignFilter { category?: string; region?: string; minCommissionBps?: number; maxCommissionBps?: number; endsAfter?: number; /** "commission" = highest first, "endingSoon" = soonest end first */ sort?: "commission" | "endingSoon"; limit?: number; offset?: number }

/** Active, not-yet-ended campaigns for discovery. */
export async function listCampaigns(r: ArkivReader, f: CampaignFilter = {}, now = Math.floor(Date.now() / 1000)) {
  const preds: Expression[] = [eq("status", "active"), gte("endsAt", u64(BigInt(f.endsAfter ?? now)))];
  if (f.category) preds.push(eq("category", f.category));
  if (f.region) preds.push(eq("region", f.region));
  if (f.minCommissionBps !== undefined) preds.push(gte("commissionBps", u64(BigInt(f.minCommissionBps))));
  if (f.maxCommissionBps !== undefined) preds.push(lte("commissionBps", u64(BigInt(f.maxCommissionBps))));
  const base = r.select().from(CampaignSchema).where(and(...preds) as never /* dynamic filter; all names are CampaignSchema columns */);
  const sorted = f.sort === "commission" ? base.orderBy(desc("commissionBps")) : f.sort === "endingSoon" ? base.orderBy(asc("endsAt")) : base;
  const res = await sorted.limit(f.limit ?? 50).offset(f.offset ?? 0).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, merchant: e.$owner, campaignId: e.campaignId.value, status: e.status.value, category: e.category.value,
    commissionBps: Number(e.commissionBps.value), endsAt: Number(e.endsAt.value), region: e.region.value, name: e.name.value, description: e.description.value,
  }));
}

export async function listOffers(r: ArkivReader, campaignId: bigint, limit = 50, offset = 0) {
  // Sorted by key so offset pages are stable while others write.
  const res = await r.select().from(OfferSchema).where(eq("campaignId", u64(campaignId))).orderBy(asc("$key")).limit(limit).offset(offset).fetch();
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

/**
 * Every live link claiming `code`, oldest first. Anyone can publish a link with any code, so this is UNVERIFIED: the caller must
 * check each candidate on-chain (an approved creator on an existing campaign) before trusting it. `createdAt` is the creation
 * block, so "first claimed" is a deterministic tie-break between two wallets that chose the same code.
 */
export async function findLinksByCode(r: ArkivReader, code: string, limit = 20) {
  const res = await r.select().from(LinkSchema).where(eq("code", code)).limit(limit).fetch();
  return res.entities
    .map((e) => ({ entityKey: e.$key as Hex, creator: e.$owner as Address, code: e.code.value, campaignId: e.campaignId.value, createdAt: Number((e as unknown as { $createdAt?: bigint }).$createdAt ?? 0n) }))
    .sort((a, b) => a.createdAt - b.createdAt || (a.entityKey < b.entityKey ? -1 : 1));
}

/** Live offers published BY `creator` (ownedBy: nobody else's offer is returned), for the creator's own "offers" tab. */
export async function listOffersByCreator(r: ArkivReader, creator: Address, limit = 50, offset = 0) {
  const res = await r.select().from(OfferSchema).where(gte("askBps", u64(0n))).ownedBy(creator).orderBy(asc("$key")).limit(limit).offset(offset).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key as Hex, creator: e.$owner as Address, campaignId: e.campaignId.value, channel: e.channel.value, audience: e.audience.value,
    askBps: Number(e.askBps.value), expectedReach: e.expectedReach.value,
  }));
}

/** Conversions for a creator, accepted only from the Numa writer wallet. */
export async function listConversions(r: ArkivReader, p: { creator: Address; writer: Address; limit?: number; offset?: number }) {
  const res = await r.select().from(ConversionSchema).where(eq("creator", addr(p.creator))).ownedBy(p.writer).limit(p.limit ?? 100).offset(p.offset ?? 0).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, creator: e.creator.value, merchant: e.merchant.value, campaignId: e.campaignId.value, gross: e.gross.value,
    commission: e.commission.value, status: e.status.value as ConversionStatus, paidAt: Number(e.paidAt.value), txHash: e.txHash.value as Hex, orderId: e.orderId.value as Hex,
  }));
}

/** Find the Numa-written conversion for an on-chain order (owner-checked). */
export async function findConversion(r: ArkivReader, p: { orderId: Hex; writer: Address }) {
  const res = await r.select().from(ConversionSchema).where(eq("orderId", p.orderId)).ownedBy(p.writer).limit(1).fetch();
  const e = res.entities[0];
  return e ? { entityKey: e.$key, gross: e.gross.value, status: e.status.value as ConversionStatus } : undefined;
}

/** Update a conversion's status (writer wallet only; other wallets' patches would not own the entity). */
export async function updateConversionStatus(w: ArkivWriter, entityKey: Hex, status: ConversionStatus): Promise<void> {
  await w.patchEntity(ConversionSchema, entityKey, { set: { status } });
}

/**
 * Every live offer. Offers expire after 72h, so "all live offers" is by construction the last 72 hours of
 * creator interest — the signal behind trending campaigns. Pages by key so a concurrent write can't skip rows.
 */
export async function listLiveOffers(r: ArkivReader, maxPages = 5, pageSize = 100) {
  const out: { entityKey: Hex; creator: Address; campaignId: bigint; askBps: number }[] = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await r.select().from(OfferSchema).orderBy(asc("$key")).limit(pageSize).offset(page * pageSize).fetch();
    for (const e of res.entities) out.push({ entityKey: e.$key, creator: e.$owner, campaignId: e.campaignId.value, askBps: Number(e.askBps.value) });
    if (res.entities.length < pageSize) break;
  }
  return out;
}

/** Largest conversions written by the Numa writer wallet, optionally for one campaign / since a time. Unverified: check against chain. */
export async function topConversions(r: ArkivReader, p: { writer: Address; campaignId?: bigint; sinceUnix?: number; limit?: number }) {
  const preds: Expression[] = [];
  if (p.campaignId !== undefined) preds.push(eq("campaignId", u64(p.campaignId)));
  if (p.sinceUnix !== undefined) preds.push(gte("paidAt", u64(BigInt(p.sinceUnix))));
  const q = r.select().from(ConversionSchema);
  const filtered = preds.length ? q.where(and(...preds) as never /* ConversionSchema columns */) : q;
  const res = await filtered.ownedBy(p.writer).orderBy(desc("gross")).limit(p.limit ?? 100).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, creator: e.creator.value, merchant: e.merchant.value, campaignId: e.campaignId.value, gross: e.gross.value,
    commission: e.commission.value, status: e.status.value as ConversionStatus, paidAt: Number(e.paidAt.value), txHash: e.txHash.value as Hex, orderId: e.orderId.value as Hex,
  }));
}

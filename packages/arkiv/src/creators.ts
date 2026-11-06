import { eq, lte, type Expression } from "@arkiv-network/sdk/query";
import { addr, bool, u64 } from "@arkiv-network/sdk/schema";
import { ExpirationTime } from "@arkiv-network/sdk";
import { and } from "@arkiv-network/sdk/query";
import type { Address, Hex } from "viem";
import type { ArkivReader, ArkivWriter } from "./client.js";
import type { PublishResult } from "./entities.js";
import { EndorsementSchema, InviteSchema, ProfileSchema } from "./schemas.js";

// ---------- creator profile (creator-owned) ----------

export interface ProfileInput {
  displayName: string; bio: string; niche: string; niches?: string[]; channel: string; handle: string; minAskBps: number; open: boolean;
}

const slug = /^[a-z0-9][a-z0-9-]{1,31}$/;
function checkProfile(p: ProfileInput) {
  if (!slug.test(p.niche)) throw new Error("niche must be a lowercase slug (2-32 chars: a-z 0-9 -)");
  if (!slug.test(p.channel)) throw new Error("channel must be a lowercase slug");
  if (!Number.isInteger(p.minAskBps) || p.minAskBps < 0 || p.minAskBps > 5000) throw new Error("minAskBps must be 0..5000");
  if (p.displayName.length === 0 || p.displayName.length > 60) throw new Error("displayName must be 1-60 chars");
  if (p.bio.length > 500) throw new Error("bio too long (max 500)");
}

/** Creator wallet. Expires in 90 days; call renewProfile to keep it live. */
export async function publishProfile(w: ArkivWriter, p: ProfileInput): Promise<PublishResult> {
  checkProfile(p);
  return w.createEntity(
    ProfileSchema,
    { displayName: p.displayName, bio: p.bio, niche: p.niche, niches: (p.niches ?? []).join(","), channel: p.channel, handle: p.handle, minAskBps: u64(BigInt(p.minAskBps)), open: bool(p.open) },
    { expiration: ExpirationTime.fromDays(90) },
  );
}

/** Creator wallet: change availability/ask without republishing. */
export async function setProfileAvailability(w: ArkivWriter, entityKey: Hex, a: { open: boolean; minAskBps?: number }) {
  const set: { open: ReturnType<typeof bool>; minAskBps?: ReturnType<typeof u64> } = { open: bool(a.open) };
  if (a.minAskBps !== undefined) set.minAskBps = u64(BigInt(a.minAskBps));
  await w.patchEntity(ProfileSchema, entityKey, { set });
}

/** Creator wallet: push expiry out another 90 days from now. */
export async function renewProfile(w: ArkivWriter, entityKey: Hex) {
  return w.extendEntity({ entityKey, expiration: ExpirationTime.fromDays(90) });
}

const toProfile = (e: { $key: Hex; $owner: Address; displayName: { value: string }; bio: { value: string }; niche: { value: string }; niches: { value: string }; channel: { value: string }; handle: { value: string }; minAskBps: { value: bigint }; open: { value: boolean } }) => ({
  entityKey: e.$key, creator: e.$owner, displayName: e.displayName.value, bio: e.bio.value, niche: e.niche.value,
  niches: e.niches.value ? e.niches.value.split(",") : [], channel: e.channel.value, handle: e.handle.value,
  minAskBps: Number(e.minAskBps.value), open: e.open.value,
});
export type CreatorProfile = ReturnType<typeof toProfile>;

/** A creator's own profile (owner-checked by construction: filtered to their wallet). */
export async function getProfile(r: ArkivReader, creator: Address): Promise<CreatorProfile | undefined> {
  const res = await r.select().from(ProfileSchema).ownedBy(creator).limit(1).fetch();
  return res.entities[0] ? toProfile(res.entities[0]) : undefined;
}

export interface CreatorSearch { niche?: string; channel?: string; maxAskBps?: number; openOnly?: boolean; limit?: number; offset?: number }

/** Merchant-side creator search over live (unexpired) profiles. */
export async function searchCreators(r: ArkivReader, f: CreatorSearch = {}): Promise<CreatorProfile[]> {
  const preds: Expression[] = [];
  if (f.openOnly ?? true) preds.push(eq("open", bool(true)));
  if (f.niche) preds.push(eq("niche", f.niche));
  if (f.channel) preds.push(eq("channel", f.channel));
  if (f.maxAskBps !== undefined) preds.push(lte("minAskBps", u64(BigInt(f.maxAskBps))));
  const q = r.select().from(ProfileSchema);
  const res = await (preds.length ? q.where(and(...preds) as never /* all names are ProfileSchema columns */) : q).limit(f.limit ?? 50).offset(f.offset ?? 0).fetch();
  return res.entities.map(toProfile);
}

// ---------- merchant invites (merchant-owned, 48h) ----------

/** Merchant wallet. */
export async function publishInvite(w: ArkivWriter, i: { campaignId: bigint; creator: Address; offeredBps: number; message: string }): Promise<PublishResult> {
  if (!Number.isInteger(i.offeredBps) || i.offeredBps <= 0 || i.offeredBps > 5000) throw new Error("offeredBps must be 1..5000");
  if (i.message.length > 280) throw new Error("message too long (max 280)");
  return w.createEntity(
    InviteSchema,
    { campaignId: u64(i.campaignId), creator: addr(i.creator), offeredBps: u64(BigInt(i.offeredBps)), message: i.message },
    { expiration: ExpirationTime.fromHours(48) },
  );
}

/**
 * Invites addressed to a creator. `merchant` is the entity owner and is UNTRUSTED here: callers must
 * confirm it equals the campaign's on-chain merchant before showing the invite as genuine.
 */
export async function listInvitesFor(r: ArkivReader, creator: Address, limit = 50) {
  const res = await r.select().from(InviteSchema).where(eq("creator", addr(creator))).limit(limit).fetch();
  return res.entities.map((e) => ({ entityKey: e.$key, merchant: e.$owner, campaignId: e.campaignId.value, creator: e.creator.value, offeredBps: Number(e.offeredBps.value), message: e.message.value }));
}

// ---------- endorsements (merchant-owned, tied to a settled order) ----------

/** Merchant wallet. Only counts once verified against the order's OrderSettled event. */
export async function publishEndorsement(
  w: ArkivWriter,
  e: { creator: Address; campaignId: bigint; orderId: Hex; txHash: Hex; rating: number; note: string },
): Promise<PublishResult> {
  if (!Number.isInteger(e.rating) || e.rating < 1 || e.rating > 5) throw new Error("rating must be an integer 1..5");
  if (e.note.length > 280) throw new Error("note too long (max 280)");
  return w.createEntity(
    EndorsementSchema,
    { creator: addr(e.creator), campaignId: u64(e.campaignId), orderId: e.orderId, txHash: e.txHash, rating: u64(BigInt(e.rating)), note: e.note },
    { expiration: ExpirationTime.fromDays(180) },
  );
}

/** Endorsements about a creator. `merchant` (= entity owner) is untrusted until verified against chain. */
export async function listEndorsements(r: ArkivReader, creator: Address, limit = 100) {
  const res = await r.select().from(EndorsementSchema).where(eq("creator", addr(creator))).limit(limit).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key, merchant: e.$owner, creator: e.creator.value, campaignId: e.campaignId.value,
    orderId: e.orderId.value as Hex, txHash: e.txHash.value as Hex, rating: Number(e.rating.value), note: e.note.value,
  }));
}


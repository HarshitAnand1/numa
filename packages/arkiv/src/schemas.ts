import { addr, bool, defineSchema, key, str, u64, u256 } from "@arkiv-network/sdk/schema";

/**
 * Numa Arkiv entity schemas. Only `.indexed()` columns can be filtered on.
 * Owner of each entity is its creating wallet ($owner) — that is the ownership guarantee.
 * Schema names are tagged on every entity as the indexed `arkiv.schema` attribute.
 */

/** Owner: merchant. */
export const CampaignSchema = defineSchema("numa.campaign", {
  campaignId: u64().indexed(), // on-chain CampaignRegistry id
  status: str().indexed(), // "active" | "paused" | "ended"
  category: str().indexed(),
  commissionBps: u64().indexed(), // max commission offered
  endsAt: u64().indexed(), // unix seconds
  region: str().indexed(),
  name: str(),
  description: str(),
});

/** Owner: creator. */
export const OfferSchema = defineSchema("numa.offer", {
  campaignId: u64().indexed(),
  channel: str().indexed(),
  audience: str(),
  askBps: u64().indexed(),
  expectedReach: u64(),
});

/** Owner: merchant. */
export const DecisionSchema = defineSchema("numa.decision", {
  offerKey: key().indexed(),
  campaignId: u64().indexed(),
  result: str().indexed(), // "approved" | "rejected"
  approveTx: str(), // approveCreator tx hash ("" when rejected)
});

/** Owner: creator. */
export const LinkSchema = defineSchema("numa.link", {
  code: str().indexed(),
  campaignId: u64().indexed(),
});

/** Owner: Numa writer wallet. Must be verifiable against OrderSettled(txHash). */
export const ConversionSchema = defineSchema("numa.conversion", {
  creator: addr().indexed(),
  merchant: addr().indexed(),
  campaignId: u64().indexed(),
  gross: u256(),
  commission: u256(),
  status: str().indexed(), // "held" | "released" | "refunded" | "partially_refunded"
  paidAt: u64().indexed(),
  txHash: str().indexed(),
  orderId: str().indexed(),
});

/** Owner: creator. Searchable by merchants; expires in 90 days unless the creator renews it (a live profile = an active creator). */
export const ProfileSchema = defineSchema("numa.profile", {
  displayName: str(),
  bio: str(),
  niche: str().indexed(), // primary niche; matches campaign `category`
  niches: str(), // comma-separated extra niches (display only)
  channel: str().indexed(), // primary channel, e.g. "youtube"
  handle: str(), // public URL/handle for the channel
  minAskBps: u64().indexed(), // lowest commission the creator will consider
  open: bool().indexed(), // currently open to offers/invites
});

/** Owner: merchant. A targeted invitation to one creator; 48h expiry. Trusted only if owner == campaign merchant. */
export const InviteSchema = defineSchema("numa.invite", {
  campaignId: u64().indexed(),
  creator: addr().indexed(),
  offeredBps: u64(),
  message: str(),
});

/** Owner: merchant. A rating tied to a settled order; counted only if the tx has a matching OrderSettled from this merchant. */
export const EndorsementSchema = defineSchema("numa.endorsement", {
  creator: addr().indexed(),
  campaignId: u64().indexed(),
  orderId: str().indexed(),
  txHash: str(),
  rating: u64().indexed(), // 1..5
  note: str(),
});

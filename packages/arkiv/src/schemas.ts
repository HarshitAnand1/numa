import { addr, defineSchema, key, str, u64, u256 } from "@arkiv-network/sdk/schema";

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

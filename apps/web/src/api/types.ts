/**
 * Response shapes of `apps/api` discovery endpoints (see docs/API.md).
 * The API serializes every bigint as a decimal string, so USDT amounts are strings in
 * base units (6 decimals). `merchantVerified: null` means "could not be checked", never "true".
 */

export interface ApiCampaign {
  entityKey: string;
  merchant: string;
  campaignId: string;
  status: string;
  category: string;
  commissionBps: number;
  endsAt: number; // unix seconds
  region: string;
  name: string;
  description: string;
  merchantVerified: boolean | null;
}

export interface ApiTrending {
  campaign: ApiCampaign;
  offerCount: number;
}

export interface ApiProfile {
  entityKey: string;
  creator: string;
  displayName: string;
  bio: string;
  niche: string;
  niches: string[];
  channel: string;
  handle: string;
  minAskBps: number;
  open: boolean;
}

export interface ApiReputation {
  verifiedConversions: number;
  distinctPayers: number;
  grossSettled: string;
  commissionEarned: string;
  /** 0-100, or null when there is no verified sales history. */
  score: number | null;
  label: string;
}

export interface ApiLeaderboardRow {
  creator: string;
  rank: number;
  score: number | null;
  verifiedConversions: number;
  distinctPayers: number;
  grossSettled: string;
  commissionEarned: string;
}

export interface ApiEndorsementItem {
  merchant: string;
  rating: number;
  note: string;
  campaignId: string;
  txHash: string;
}

export interface ApiRecentSale {
  txHash: string;
  campaignId: string;
  gross: string;
  commission: string;
  status: "held" | "released" | "refunded" | "partially_refunded";
  paidAt: number;
}

export interface ApiRejected {
  txHash: string;
  reason: string;
}

export interface ApiCreatorCard {
  address: string;
  profile: ApiProfile | null;
  reputation: ApiReputation;
  endorsements: {
    count: number;
    averageRating: number | null;
    distinctMerchants: number;
    items: ApiEndorsementItem[];
  };
  recentSales: ApiRecentSale[];
  rejected: { conversions: ApiRejected[]; endorsements: ApiRejected[] };
}

/** `GET /creators/:address/recommendations`: active campaigns matching the creator's niches and minimum ask. */
export interface ApiRecommendation {
  campaign: ApiCampaign;
  /** category equals the creator's primary niche (vs. one of their extra niches) */
  primaryMatch: boolean;
}

/**
 * `GET /creators/:address/invites`. `verified` is whether the inviting wallet is the campaign's
 * on-chain merchant (null = could not be checked). The API does not expose the 48h expiry.
 */
export interface ApiInvite {
  entityKey: string;
  merchant: string;
  campaignId: string;
  creator: string;
  offeredBps: number;
  message: string;
  verified: boolean | null;
}

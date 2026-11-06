import { bpsToPercent, timeLeft } from "./format";
import type { ApiCampaign } from "./types";

/** What the campaign rows render. Derived from an ApiCampaign; nothing here is stored. */
export interface CampaignView {
  id: string;
  campaignId: string;
  name: string;
  category: string;
  region: string;
  /** percent, e.g. 12.5 */
  commission: number;
  commissionLabel: string;
  ends: string;
  endsAt: number;
  offers: number;
  verified: "verified" | "unverified" | "unchecked";
  merchant: string;
}

export function toCampaignView(c: ApiCampaign, offers = 0, now?: number): CampaignView {
  return {
    id: `#${c.campaignId}`,
    campaignId: c.campaignId,
    name: c.name || `Campaign #${c.campaignId}`,
    category: c.category,
    region: c.region,
    commission: c.commissionBps / 100,
    commissionLabel: bpsToPercent(c.commissionBps),
    ends: timeLeft(c.endsAt, now),
    endsAt: c.endsAt,
    offers,
    // true/false are claims checked against the on-chain merchant; null means "not checked".
    verified: c.merchantVerified === true ? "verified" : c.merchantVerified === false ? "unverified" : "unchecked",
    merchant: c.merchant,
  };
}

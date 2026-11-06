import { computeReputation, type ReputationInput } from "./reputation.js";

export interface CampaignLite { campaignId: bigint; category: string; commissionBps: number; endsAt: number; status: string; [k: string]: unknown }
export interface ProfileLite { niche: string; niches: string[]; minAskBps: number; open: boolean }

/** Campaigns ranked by creator interest in the last 72h (live offers), ties broken by commission. */
export function trendingCampaigns<C extends CampaignLite>(offers: { campaignId: bigint }[], campaigns: C[], limit = 10) {
  const counts = new Map<bigint, number>();
  for (const o of offers) counts.set(o.campaignId, (counts.get(o.campaignId) ?? 0) + 1);
  return campaigns
    .map((c) => ({ campaign: c, offerCount: counts.get(c.campaignId) ?? 0 }))
    .sort((a, b) => b.offerCount - a.offerCount || b.campaign.commissionBps - a.campaign.commissionBps)
    .slice(0, limit);
}

/** Active campaigns that fit a creator: category in their niches and commission cap >= their minimum ask. Best first. */
export function recommendCampaigns<C extends CampaignLite>(profile: ProfileLite, campaigns: C[], now = Math.floor(Date.now() / 1000), limit = 10) {
  const niches = new Set([profile.niche, ...profile.niches]);
  return campaigns
    .filter((c) => c.status === "active" && c.endsAt > now && niches.has(c.category) && c.commissionBps >= profile.minAskBps)
    .map((c) => ({ campaign: c, primaryMatch: c.category === profile.niche }))
    .sort((a, b) => Number(b.primaryMatch) - Number(a.primaryMatch) || b.campaign.commissionBps - a.campaign.commissionBps)
    .slice(0, limit);
}

export interface LeaderboardRow { creator: string; rank: number; score: number | null; verifiedConversions: number; distinctPayers: number; grossSettled: bigint; commissionEarned: bigint }

/** Rank creators by verified-settlement reputation score (ties: gross). Input rows must already be chain-verified. */
export function leaderboard(rows: (ReputationInput & { creator: string })[], limit = 20): LeaderboardRow[] {
  const by = new Map<string, ReputationInput[]>();
  for (const r of rows) { const k = r.creator.toLowerCase(); (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  return [...by.entries()]
    .map(([creator, rs]) => ({ creator, rep: computeReputation(rs) }))
    .filter((x) => x.rep.score !== null)
    .sort((a, b) => b.rep.score! - a.rep.score! || Number(b.rep.grossSettled - a.rep.grossSettled))
    .slice(0, limit)
    .map((x, i) => ({ creator: x.creator, rank: i + 1, score: x.rep.score, verifiedConversions: x.rep.verifiedConversions, distinctPayers: x.rep.distinctPayers, grossSettled: x.rep.grossSettled, commissionEarned: x.rep.commissionEarned }));
}

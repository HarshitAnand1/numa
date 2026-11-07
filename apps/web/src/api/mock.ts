import type { ApiCampaign, ApiCreatorCard, ApiInvite, ApiLeaderboardRow, ApiRecommendation, ApiTrending } from "./types";

/**
 * DEMO DATA. Only used when the API is unreachable or VITE_DATA_MODE=demo, and every screen
 * that shows it carries a visible "DEMO DATA" badge. None of this is real or on-chain.
 */

const addr = (head: string, tail: string) => `0x${head}${"0".repeat(40 - head.length - tail.length)}${tail}`;

export const DEMO_CREATOR = addr("71c9d8f03a", "d03a");
const MARA = addr("39a1c4e07b", "a18f");
const NOAH = addr("0b77e1d2c9", "9100");
const DEAD = addr("82c0aa51f3", "c02e");
const MOTEL = addr("fa81190d44", "8113");

const MERCHANT_A = addr("c0ffee0001", "0001");
const MERCHANT_B = addr("c0ffee0002", "0002");

export function demoCampaigns(now = Math.floor(Date.now() / 1000)): ApiCampaign[] {
  const mk = (
    id: number,
    name: string,
    category: string,
    region: string,
    commissionBps: number,
    endsInSec: number,
    merchantVerified: boolean | null,
    merchant: string,
    description: string,
  ): ApiCampaign => ({
    entityKey: `0xdemo${id.toString(16).padStart(60, "0")}`,
    merchant,
    campaignId: String(id),
    status: "active",
    category,
    commissionBps,
    endsAt: now + endsInSec,
    region,
    name,
    description,
    merchantVerified,
  });
  return [
    mk(8, "NO SLEEP / DROP 08", "streetwear", "global", 1800, 2 * 86400 + 14 * 3600, true, MERCHANT_A, "Limited footwear drop. Bone upper, acid sole."),
    mk(221, "VINYL IS NOT DEAD", "music", "US + EU", 2400, 18 * 3600 + 9 * 60, null, MERCHANT_B, "Pressed-to-order records from independent labels."),
    mk(404, "RUN AFTER DARK", "fitness", "US", 1250, 6 * 86400 + 3 * 3600, true, MERCHANT_A, "Night-run kit: reflective layers and lights."),
    mk(110, "READ BANNED BOOKS", "culture", "global", 3000, 9 * 86400 + 22 * 3600, false, MERCHANT_B, "A subscription of books somebody tried to remove."),
  ];
}

export function demoTrending(now?: number): ApiTrending[] {
  const counts: Record<string, number> = { "8": 42, "221": 31, "404": 19, "110": 11 };
  return demoCampaigns(now)
    .map((campaign) => ({ campaign, offerCount: counts[campaign.campaignId] ?? 0 }))
    .sort((a, b) => b.offerCount - a.offerCount);
}

export function demoLeaderboard(): ApiLeaderboardRow[] {
  const row = (rank: number, creator: string, score: number, n: number, payers: number, gross: number, commission: number): ApiLeaderboardRow => ({
    creator,
    rank,
    score,
    verifiedConversions: n,
    distinctPayers: payers,
    grossSettled: String(gross * 1_000_000),
    commissionEarned: String(commission * 1_000_000),
  });
  return [
    row(1, DEMO_CREATOR, 87, 142, 118, 8420, 1477),
    row(2, MARA, 84, 119, 101, 7103, 1210),
    row(3, NOAH, 79, 98, 80, 5441, 902),
    row(4, DEAD, 76, 91, 70, 4882, 811),
    row(5, MOTEL, 71, 76, 60, 3901, 640),
  ];
}

export function demoCreatorCard(address: string = DEMO_CREATOR, now = Math.floor(Date.now() / 1000)): ApiCreatorCard {
  return {
    address,
    profile: {
      entityKey: "0xdemo-profile",
      creator: address,
      displayName: "Rio Santos",
      bio: "night runner, camera carrier, reluctant influencer. moving shoes, records, and things built to last.",
      niche: "streetwear",
      niches: ["running", "photography", "video / short"],
      channel: "youtube",
      handle: "@rio.santos",
      minAskBps: 1000,
      open: true,
    },
    reputation: {
      verifiedConversions: 142,
      distinctPayers: 118,
      grossSettled: "8420000000",
      commissionEarned: "1477800000",
      score: 87,
      label: "142 verified sale(s)",
    },
    endorsements: {
      count: 4,
      averageRating: 4.8,
      distinctMerchants: 2,
      items: [
        {
          merchant: MERCHANT_A,
          rating: 5,
          note: "specific brief, clean traffic, zero nonsense.",
          campaignId: "8",
          txHash: `0x${"a91f".padEnd(64, "0")}`,
        },
      ],
    },
    recentSales: [
      { txHash: `0x${"a91f".padEnd(64, "2")}`, campaignId: "8", gross: "42000000", commission: "7560000", status: "held", paidAt: now - 120 },
      { txHash: `0x${"8bc0".padEnd(64, "7")}`, campaignId: "404", gross: "89000000", commission: "11125000", status: "held", paidAt: now - 3 * 3600 },
      { txHash: `0x${"d030".padEnd(64, "1")}`, campaignId: "221", gross: "24000000", commission: "5760000", status: "released", paidAt: now - 26 * 3600 },
    ],
    rejected: {
      conversions: [
        { txHash: `0x${"bad1".padEnd(64, "0")}`, reason: "no matching OrderSettled event" },
        { txHash: `0x${"bad2".padEnd(64, "0")}`, reason: "creator in event differs from the claim" },
      ],
      endorsements: [{ txHash: `0x${"bad3".padEnd(64, "0")}`, reason: "author is not the order's merchant" }],
    },
  };
}

export function demoRecommendations(now?: number): ApiRecommendation[] {
  const c = demoCampaigns(now);
  return [
    { campaign: c[0], primaryMatch: true },
    { campaign: c[2], primaryMatch: false },
  ];
}

export function demoInvites(): ApiInvite[] {
  return [
    { entityKey: "0xdemo-invite-1", merchant: MERCHANT_A, campaignId: "8", creator: DEMO_CREATOR, offeredBps: 1800, message: "your night-run edits are exactly the brief.", verified: true },
    { entityKey: "0xdemo-invite-2", merchant: MERCHANT_B, campaignId: "110", creator: DEMO_CREATOR, offeredBps: 2400, message: "", verified: null },
  ];
}

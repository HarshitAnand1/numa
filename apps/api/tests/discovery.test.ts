import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Hex } from "viem";
import { numaRouterAbi } from "@numa/shared";
import { summarizeEndorsements, verifiedEndorsements, verifyEndorsement, type EndorsementClaim } from "../src/services/endorsements.js";
import { leaderboard, recommendCampaigns, trendingCampaigns } from "../src/services/discovery.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const merchant = "0x3333333333333333333333333333333333333333" as const;
const stranger = "0x5555555555555555555555555555555555555555" as const;
const buyer = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const oid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const tx = (n: number) => `0x${(n + 200).toString(16).padStart(64, "0")}` as Hex;

function settled(orderId: Hex, over: { merchant?: `0x${string}`; creator?: `0x${string}`; campaignId?: bigint } = {}) {
  const item = getAbiItem({ abi: numaRouterAbi, name: "OrderSettled" });
  return {
    address: router, blockNumber: 10n, transactionHash: tx(1), logIndex: 0, blockHash: `0x${"bb".repeat(32)}`, transactionIndex: 0, removed: false,
    topics: encodeEventTopics({ abi: [item], eventName: "OrderSettled", args: { orderId, campaignId: over.campaignId ?? 7n, merchant: over.merchant ?? merchant } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [over.creator ?? creator, buyer(9), 100_000_000n, 89_500_000n, 10_000_000n, 500_000n]),
  };
}
const pubWith = (logsByTx: Record<string, unknown[]>) => ({
  getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => { const l = logsByTx[hash]; if (!l) throw new Error("nf"); return { status: "success", logs: l, blockNumber: 10n }; }),
}) as never;
const claim = (n: number, over: Partial<EndorsementClaim> = {}): EndorsementClaim => ({
  merchant, creator, campaignId: 7n, orderId: oid(n), txHash: tx(n), rating: 5, note: "ok", entityKey: oid(1000 + n), ...over,
});

describe("endorsement verification", () => {
  it("accepts an endorsement by the order's merchant", async () => {
    const pub = pubWith({ [tx(1)]: [settled(oid(1))] });
    expect(await verifyEndorsement(pub, router, claim(1))).toEqual({ ok: true });
  });
  it("rejects an author who is not the order's merchant (no smearing/boosting from strangers)", async () => {
    const pub = pubWith({ [tx(1)]: [settled(oid(1))] });
    expect(await verifyEndorsement(pub, router, claim(1, { merchant: stranger }))).toMatchObject({ ok: false, reason: "author is not the order's merchant" });
  });
  it("rejects wrong creator, wrong campaign and unknown tx", async () => {
    const pub = pubWith({ [tx(1)]: [settled(oid(1))] });
    expect(await verifyEndorsement(pub, router, claim(1, { creator: stranger }))).toMatchObject({ ok: false, reason: "creator mismatch" });
    expect(await verifyEndorsement(pub, router, claim(1, { campaignId: 8n }))).toMatchObject({ ok: false, reason: "campaign mismatch" });
    expect(await verifyEndorsement(pub, router, claim(2))).toMatchObject({ ok: false, reason: "tx not found" });
  });
  it("counts one endorsement per order and summarizes", async () => {
    const pub = pubWith({ [tx(1)]: [settled(oid(1))], [tx(2)]: [settled(oid(2))] });
    const { accepted, rejected } = await verifiedEndorsements(pub, router, [
      claim(1, { rating: 5, entityKey: oid(1) }), claim(1, { rating: 1, entityKey: oid(2000) }), // duplicate for order 1
      claim(2, { rating: 4 }), claim(3, { rating: 5 }), // order 3 has no tx
    ]);
    expect(accepted.map((a) => a.rating).sort()).toEqual([4, 5]);
    expect(rejected.map((r) => r.reason).sort()).toEqual(["duplicate endorsement for order", "tx not found"]);
    expect(summarizeEndorsements(accepted)).toEqual({ count: 2, averageRating: 4.5, distinctMerchants: 1 });
    expect(summarizeEndorsements([])).toEqual({ count: 0, averageRating: null, distinctMerchants: 0 });
  });
});

describe("discovery ranking", () => {
  const camp = (id: number, category: string, bps: number, over: object = {}) => ({ campaignId: BigInt(id), category, commissionBps: bps, endsAt: 5_000, status: "active", ...over });
  it("trending ranks by live offers, ties by commission", () => {
    const out = trendingCampaigns([{ campaignId: 2n }, { campaignId: 2n }, { campaignId: 1n }], [camp(1, "a", 900), camp(2, "a", 100), camp(3, "a", 1500)], 3);
    expect(out.map((o) => [o.campaign.campaignId, o.offerCount])).toEqual([[2n, 2], [1n, 1], [3n, 0]]);
  });
  it("recommends only active, unexpired campaigns in the creator's niches above their minimum ask, primary niche first", () => {
    const profile = { niche: "devtools", niches: ["ai"], minAskBps: 500, open: true };
    const out = recommendCampaigns(profile, [
      camp(1, "ai", 2000), camp(2, "devtools", 800), camp(3, "devtools", 300), camp(4, "fashion", 3000),
      camp(5, "devtools", 900, { status: "paused" }), camp(6, "devtools", 900, { endsAt: 100 }),
    ], 1_000);
    expect(out.map((o) => o.campaign.campaignId)).toEqual([2n, 1n]);
  });
  it("leaderboard ranks by verified reputation and drops creators with no live sales", () => {
    const row = (c: string, b: string, g: bigint, refunded = false) => ({ creator: c, buyer: b as `0x${string}`, gross: g, commission: g / 10n, refunded });
    const out = leaderboard([
      ...Array.from({ length: 5 }, (_, i) => row("0xA", buyer(i + 1), 200_000_000n)),
      row("0xB", buyer(1), 1_000_000n),
      row("0xC", buyer(1), 50_000_000n, true), // fully refunded -> no score
    ]);
    expect(out.map((o) => [o.creator, o.rank])).toEqual([["0xa", 1], ["0xb", 2]]);
    expect(out[0]!.distinctPayers).toBe(5);
  });
});

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem } from "viem";
import { numaRouterAbi } from "@numa/shared";
import { registerDiscoveryRoutes } from "../src/routes/discovery.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const registry = "0x6666666666666666666666666666666666666666" as const;
const writer = "0x4444444444444444444444444444444444444444" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const merchant = "0x3333333333333333333333333333333333333333" as const;
const stranger = "0x5555555555555555555555555555555555555555" as const;
const orderId = `0x${"0a".repeat(32)}` as const;
const txHash = `0x${"ee".repeat(32)}` as const;

const settledLog = () => {
  const item = getAbiItem({ abi: numaRouterAbi, name: "OrderSettled" });
  return {
    address: router, blockNumber: 10n, transactionHash: txHash, logIndex: 0, blockHash: `0x${"bb".repeat(32)}`, transactionIndex: 0, removed: false,
    topics: encodeEventTopics({ abi: [item], eventName: "OrderSettled", args: { orderId, campaignId: 7n, creator } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [merchant, "0x0000000000000000000000000000000000000009", 100_000_000n, 89_500_000n, 10_000_000n, 500_000n]),
  };
};

/** Fake of the SDK query chain keyed by schema name; returns rows configured per schema. */
function fakeArkiv(rows: Record<string, unknown[]>) {
  let schema = "";
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.from = (s: { name?: string }) => { schema = s.name ?? ""; return b; };
  for (const m of ["where", "ownedBy", "limit", "offset", "orderBy"]) b[m] = () => b;
  b.fetch = async () => ({ entities: rows[schema] ?? [], skipped: 0 });
  return b as never;
}
const campaignRow = (id: bigint, owner: string, category = "devtools", bps = 800n) => ({
  $key: `0xc${id}`, $owner: owner, campaignId: { value: id }, status: { value: "active" }, category: { value: category }, commissionBps: { value: bps },
  endsAt: { value: 9_999_999_999n }, region: { value: "in" }, name: { value: "n" }, description: { value: "d" },
});
const conv = { $key: "0xv", creator: { value: creator }, merchant: { value: merchant }, campaignId: { value: 7n }, gross: { value: 100_000_000n }, commission: { value: 10_000_000n }, status: { value: "held" }, paidAt: { value: 1_700_000_000n }, txHash: { value: txHash }, orderId: { value: orderId } };

function app(rows: Record<string, unknown[]>, opts: { registryMerchant?: string } = {}) {
  const pub = {
    getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [settledLog()], blockNumber: 10n }),
    readContract: vi.fn().mockResolvedValue(opts.registryMerchant ?? merchant),
  } as never;
  const a = Fastify();
  registerDiscoveryRoutes(a, { arkiv: fakeArkiv(rows), pub, router, writer, ...(opts.registryMerchant !== undefined || true ? { registry } : {}), cache: new Map(), now: () => 1_000 });
  return a;
}

describe("discovery routes", () => {
  it("campaign discovery flags whether the Arkiv owner is the on-chain merchant", async () => {
    const a = app({ "numa.campaign": [campaignRow(7n, merchant), campaignRow(8n, stranger)] });
    const body = (await a.inject("/discovery/campaigns")).json();
    expect(body.map((c: { campaignId: string; merchantVerified: boolean }) => [c.campaignId, c.merchantVerified])).toEqual([["7", true], ["8", false]]);
  });
  it("invites are verified against the campaign's on-chain merchant (spoofed invites flagged)", async () => {
    const invite = (owner: string) => ({ $key: "0xi", $owner: owner, campaignId: { value: 7n }, creator: { value: creator }, offeredBps: { value: 700n }, message: { value: "hi" } });
    const a = app({ "numa.invite": [invite(merchant), invite(stranger)] });
    const body = (await a.inject(`/creators/${creator}/invites`)).json();
    expect(body.map((i: { verified: boolean }) => i.verified)).toEqual([true, false]);
  });
  it("creator card combines profile, verified sales, endorsements and reputation; rejects forged endorsements", async () => {
    const profile = { $key: "0xp", $owner: creator, displayName: { value: "Ada" }, bio: { value: "b" }, niche: { value: "devtools" }, niches: { value: "" }, channel: { value: "youtube" }, handle: { value: "h" }, minAskBps: { value: 500n }, open: { value: true } };
    const endorsement = (owner: string, key: string) => ({ $key: key, $owner: owner, creator: { value: creator }, campaignId: { value: 7n }, orderId: { value: orderId }, txHash: { value: txHash }, rating: { value: 5n }, note: { value: "great" } });
    const a = app({ "numa.profile": [profile], "numa.conversion": [conv], "numa.endorsement": [endorsement(merchant, "0x01"), endorsement(stranger, "0x02")] });
    const card = (await a.inject(`/creators/${creator}`)).json();
    expect(card.profile.displayName).toBe("Ada");
    expect(card.reputation).toMatchObject({ verifiedConversions: 1, distinctPayers: 1, grossSettled: "100000000" });
    expect(card.reputation.score).toBeGreaterThan(0);
    expect(card.endorsements).toMatchObject({ count: 1, averageRating: 5 });
    expect(card.endorsements.items[0].merchant.toLowerCase()).toBe(merchant);
    expect(card.rejected.endorsements).toHaveLength(1);
    expect(card.recentSales[0]).toMatchObject({ txHash, status: "held" });
  });
  it("creator with no history returns the empty label, null score and no profile", async () => {
    const card = (await app({}).inject(`/creators/${creator}`)).json();
    expect(card).toMatchObject({ profile: null, reputation: { score: null, label: "No verified sales history yet." }, endorsements: { count: 0, averageRating: null } });
  });
  it("recommendations require a profile and match niche and minimum ask", async () => {
    expect((await app({}).inject(`/creators/${creator}/recommendations`)).statusCode).toBe(404);
    const profile = { $key: "0xp", $owner: creator, displayName: { value: "A" }, bio: { value: "" }, niche: { value: "devtools" }, niches: { value: "" }, channel: { value: "youtube" }, handle: { value: "" }, minAskBps: { value: 500n }, open: { value: true } };
    const a = app({ "numa.profile": [profile], "numa.campaign": [campaignRow(7n, merchant, "devtools", 800n), campaignRow(8n, merchant, "fashion", 900n), campaignRow(9n, merchant, "devtools", 100n)] });
    const out = (await a.inject(`/creators/${creator}/recommendations`)).json();
    expect(out.map((o: { campaign: { campaignId: string } }) => o.campaign.campaignId)).toEqual(["7"]);
  });
  it("leaderboard ranks verified creators; trending counts live offers", async () => {
    const lb = (await app({ "numa.conversion": [conv] }).inject("/discovery/leaderboard")).json();
    expect(lb[0]).toMatchObject({ rank: 1, verifiedConversions: 1 });
    const offer = (id: bigint) => ({ $key: `0xo${id}`, $owner: creator, campaignId: { value: id }, askBps: { value: 500n } });
    const tr = (await app({ "numa.campaign": [campaignRow(7n, merchant), campaignRow(8n, merchant)], "numa.offer": [offer(8n), offer(8n)] }).inject("/discovery/trending")).json();
    expect(tr[0]).toMatchObject({ offerCount: 2 });
    expect(tr[0].campaign.campaignId).toBe("8");
  });
  it("rejects invalid addresses", async () => {
    for (const path of ["", "/reputation", "/recommendations", "/invites"]) expect((await app({}).inject(`/creators/nope${path}`)).statusCode).toBe(400);
  });
});

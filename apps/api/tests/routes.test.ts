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
    topics: encodeEventTopics({ abi: [item], eventName: "OrderSettled", args: { orderId, campaignId: 7n, merchant } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [creator, "0x0000000000000000000000000000000000000009", 100_000_000n, 89_500_000n, 10_000_000n, 500_000n]),
  };
};

/** Fake of the SDK query chain keyed by schema name; returns rows configured per schema. */
function fakeArkiv(rows: Record<string, unknown[]>) {
  let schema = "";
  let owner: string | undefined;
  const b: Record<string, unknown> = {};
  b.select = () => { owner = undefined; return b; };
  b.from = (s: { name?: string }) => { schema = s.name ?? ""; return b; };
  for (const m of ["where", "limit", "offset", "orderBy"]) b[m] = () => b;
  // mirrors Arkiv's ownedBy: rows carrying an $owner are only returned for that owner
  b.ownedBy = (o: string) => { owner = o.toLowerCase(); return b; };
  b.fetch = async () => ({ entities: (rows[schema] ?? []).filter((e) => { const o = (e as { $owner?: string }).$owner; return owner === undefined || o === undefined || o.toLowerCase() === owner; }), skipped: 0 });
  return b as never;
}
const campaignRow = (id: bigint, owner: string, category = "devtools", bps = 800n) => ({
  $key: `0xc${id}`, $owner: owner, campaignId: { value: id }, status: { value: "active" }, category: { value: category }, commissionBps: { value: bps },
  endsAt: { value: 9_999_999_999n }, region: { value: "in" }, name: { value: "n" }, description: { value: "d" },
});
const conv = { $key: "0xv", creator: { value: creator }, merchant: { value: merchant }, campaignId: { value: 7n }, gross: { value: 100_000_000n }, commission: { value: 10_000_000n }, status: { value: "held" }, paidAt: { value: 1_700_000_000n }, txHash: { value: txHash }, orderId: { value: orderId } };

function app(rows: Record<string, unknown[]>, opts: { registryMerchant?: string; approved?: boolean; approvedFor?: (creator: string) => boolean; settleable?: boolean } = {}) {
  const pub = {
    getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [settledLog()], blockNumber: 10n }),
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args: unknown[] }) => functionName === "isSettleable" ? (opts.settleable ?? true) : functionName === "isCreatorApproved" ? (opts.approvedFor ? opts.approvedFor(String(args[1])) : (opts.approved ?? false)) : { merchant: opts.registryMerchant ?? merchant, payoutSigner: merchant, commissionBps: 800n, endsAt: 9_999_999_999n, paused: false, exists: true }),
  } as never;
  const a = Fastify();
  registerDiscoveryRoutes(a, { arkiv: fakeArkiv(rows), pub, router, writer, registry, cache: new Map(), now: () => 1_000 });
  return a;
}

describe("GET /links/:code", () => {
  const link = (key: string, owner: string, code = "SPRING24", createdAt = 100n, campaignId = 7n) => ({ $key: key, $owner: owner, $createdAt: createdAt, code: { value: code }, campaignId: { value: campaignId } });
  it("resolves a code to its creator and campaign when the creator is approved on-chain", async () => {
    const a = app({ "numa.link": [link("0xl1", creator)] }, { approved: true });
    const r = (await a.inject("/links/SPRING24")).json();
    expect(r).toMatchObject({ code: "SPRING24", creator, campaignId: "7", merchant, approved: true, settleable: true, claims: 1 });
  });
  it("refuses a link whose owner is not approved (a squatter cannot redirect sales), and says why", async () => {
    const a = app({ "numa.link": [link("0xl1", stranger)] }, { approved: false });
    const res = await a.inject("/links/SPRING24");
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("NOT_APPROVED");
  });
  it("when several approved creators claim a code, the earliest claim wins and the conflict is reported", async () => {
    const a = app({ "numa.link": [link("0xl2", stranger, "SPRING24", 200n), link("0xl1", creator, "SPRING24", 100n)] }, { approved: true });
    const r = (await a.inject("/links/SPRING24")).json();
    expect(r).toMatchObject({ creator, claims: 2 });
  });
  it("ignores an unapproved squatter even if they claimed first", async () => {
    const a = app({ "numa.link": [link("0xl1", stranger, "SPRING24", 50n), link("0xl2", creator, "SPRING24", 100n)] }, { approvedFor: (c) => c.toLowerCase() === creator.toLowerCase() });
    expect((await a.inject("/links/SPRING24")).json()).toMatchObject({ creator, claims: 1 });
  });
  it("404s an unknown code, 400s a malformed one, and reports a paused campaign as not settleable", async () => {
    expect((await app({}).inject("/links/NOPE1234")).statusCode).toBe(404);
    expect((await app({}).inject("/links/a!")).statusCode).toBe(400);
    const a = app({ "numa.link": [link("0xl1", creator)] }, { approved: true, settleable: false });
    expect((await a.inject("/links/SPRING24")).json().settleable).toBe(false);
  });
});

describe("GET /creators/:address/offers", () => {
  const offer = (key: string, owner: string, campaignId = 7n, ask = 900n) => ({ $key: key, $owner: owner, campaignId: { value: campaignId }, channel: { value: "youtube" }, audience: { value: "devs" }, askBps: { value: ask }, expectedReach: { value: 5000n } });
  const decision = (owner: string, offerKey: string, result: string) => ({ $key: `0xd${offerKey}`, $owner: owner, offerKey: { value: offerKey }, campaignId: { value: 7n }, result: { value: result }, approveTx: { value: "" } });
  it("lists only the creator's own offers with campaign name and status", async () => {
    const a = app({ "numa.offer": [offer("0xo1", creator), offer("0xo2", stranger)], "numa.campaign": [campaignRow(7n, merchant)] }, { approved: false });
    const r = (await a.inject(`/creators/${creator}/offers`)).json();
    expect(r).toMatchObject({ creator, count: 1 });
    expect(r.offers[0]).toMatchObject({ offerKey: "0xo1", campaignName: "n", askBps: 900, status: "pending", decision: null, approvedOnChain: false });
  });
  it("status follows the merchant's verified decision and the on-chain approval", async () => {
    const approved = app({ "numa.offer": [offer("0xo1", creator)], "numa.campaign": [campaignRow(7n, merchant)] }, { approved: true });
    expect((await approved.inject(`/creators/${creator}/offers`)).json().offers[0].status).toBe("approved");
    const rejected = app({ "numa.offer": [offer("0xo1", creator)], "numa.campaign": [campaignRow(7n, merchant)], "numa.decision": [decision(merchant, "0xo1", "rejected")] }, { approved: false });
    expect((await rejected.inject(`/creators/${creator}/offers`)).json().offers[0]).toMatchObject({ status: "rejected", decision: "rejected" });
    const forged = app({ "numa.offer": [offer("0xo1", creator)], "numa.campaign": [campaignRow(7n, merchant)], "numa.decision": [decision(stranger, "0xo1", "approved")] }, { approved: false });
    expect((await forged.inject(`/creators/${creator}/offers`)).json().offers[0]).toMatchObject({ status: "pending", decision: null }); // a stranger's "approval" is ignored
  });
  it("rejects a bad address and returns an empty list for a creator with no offers", async () => {
    expect((await app({}).inject("/creators/nope/offers")).statusCode).toBe(400);
    expect((await app({}).inject(`/creators/${creator}/offers`)).json()).toMatchObject({ count: 0, offers: [] });
  });
});

describe("GET /campaigns/:id/offers", () => {
  const offer = (key: string, owner: string, ask = 900n) => ({ $key: key, $owner: owner, campaignId: { value: 7n }, channel: { value: "youtube" }, audience: { value: "devs" }, askBps: { value: ask }, expectedReach: { value: 5000n } });
  const decision = (owner: string, offerKey: string, result: string) => ({ $key: `0xd${offerKey}`, $owner: owner, offerKey: { value: offerKey }, campaignId: { value: 7n }, result: { value: result }, approveTx: { value: "" } });
  const profile = { $key: "0xp", $owner: creator, displayName: { value: "Ada" }, bio: { value: "b" }, niche: { value: "devtools" }, niches: { value: "" }, channel: { value: "youtube" }, handle: { value: "h" }, minAskBps: { value: 500n }, open: { value: true } };

  it("lists offers with the creator's profile, the merchant's decision and the on-chain approval", async () => {
    const a = app({ "numa.offer": [offer("0xo1", creator), offer("0xo2", stranger, 1500n)], "numa.profile": [profile], "numa.decision": [decision(merchant, "0xo1", "approved")] }, { approved: true });
    const r = (await a.inject("/campaigns/7/offers")).json();
    expect(r).toMatchObject({ campaignId: "7", merchant, merchantVerified: true, count: 2 });
    const o1 = r.offers.find((o: { offerKey: string }) => o.offerKey === "0xo1");
    expect(o1).toMatchObject({ creator, askBps: 900, expectedReach: "5000", profile: { displayName: "Ada" }, decision: "approved", approvedOnChain: true });
    expect(r.offers.find((o: { offerKey: string }) => o.offerKey === "0xo2")).toMatchObject({ profile: null, decision: null });
  });
  it("ignores a 'decision' written by someone who is not the campaign's on-chain merchant", async () => {
    const a = app({ "numa.offer": [offer("0xo1", creator)], "numa.decision": [decision(stranger, "0xo1", "approved")] });
    const r = (await a.inject("/campaigns/7/offers")).json();
    expect(r.offers[0].decision).toBeNull(); // the fake only returns decisions owned by the merchant, mirroring ownedBy
  });
  it("reports the on-chain approval as false when not approved, and rejects a bad id", async () => {
    const a = app({ "numa.offer": [offer("0xo1", creator)] }, { approved: false });
    expect((await a.inject("/campaigns/7/offers")).json().offers[0].approvedOnChain).toBe(false);
    expect((await a.inject("/campaigns/abc/offers")).statusCode).toBe(400);
  });
});

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

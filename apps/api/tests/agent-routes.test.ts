import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { policyAuthMessage } from "@numa/shared";

const C = "0x00000000000000000000000000000000000000a1" as Address; // creator
const C2 = "0x00000000000000000000000000000000000000a2" as Address; // another creator
const M = "0x00000000000000000000000000000000000000b2" as Address; // merchant
const M2 = "0x00000000000000000000000000000000000000b3" as Address;
const AGENT = "0x00000000000000000000000000000000000000c3" as Address;
const O1 = ("0x" + "11".repeat(32)) as Hex, O2 = ("0x" + "22".repeat(32)) as Hex;
const registry = "0x00000000000000000000000000000000000000f1" as Address;

vi.mock("@numa/arkiv", async (orig) => {
  const real = await orig<typeof import("@numa/arkiv")>();
  return {
    ...real,
    listLiveOffers: vi.fn(async () => [
      { entityKey: O1, creator: C, campaignId: 7n, askBps: 1200 },
      { entityKey: O2, creator: C2, campaignId: 8n, askBps: 900 },
    ]),
    listCampaigns: vi.fn(async () => [
      { campaignId: 7n, commissionBps: 2000n, category: "tech", name: "Seven", merchant: M },
      { campaignId: 8n, commissionBps: 2000n, category: "tech", name: "Eight", merchant: M2 },
    ]),
    listAgentBindings: vi.fn(async (_r: unknown, principal: Address, role: string) => (principal === M && role === "merchant" ? [{ entityKey: "0x01", principal, agent: AGENT, role }] : [])),
    listNegotiation: vi.fn(async (_r: unknown, offerKey: Hex) =>
      offerKey === O1
        ? [
          { entityKey: "0x0a", owner: AGENT, offerKey, campaignId: 7n, creator: C, merchant: M, from: "merchant", seq: 1, action: "propose", bps: 800, note: "hello" },
          { entityKey: "0x0b", owner: "0x00000000000000000000000000000000000000d4", offerKey, campaignId: 7n, creator: C, merchant: M, from: "creator", seq: 2, action: "accept", bps: 800, note: "forged" },
        ]
        : []),
  };
});

const MemoryPolicyStore = (await import("../src/agents/store.js")).MemoryPolicyStore;
const { registerAgentRoutes } = await import("../src/routes/agents.js");

function app(agentAddress: Address | null = AGENT) {
  const pub = { readContract: vi.fn(async ({ args }: { args: [bigint] }) => ({ exists: true, merchant: args[0] === 7n ? M : M2, commissionBps: 2000n, payoutSigner: M, endsAt: 9_999_999_999n })) } as never;
  const a = Fastify();
  registerAgentRoutes(a, { arkiv: {} as never, pub, registry, store: new MemoryPolicyStore(), ...(agentAddress && { agentAddress }), now: () => 1_000 });
  return a;
}

describe("GET /agents/threads", () => {
  it("lists a creator's own offers only, with verified state (forged messages are ignored and counted)", async () => {
    const r = (await app().inject(`/agents/threads?principal=${C}&role=creator`)).json();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ offerKey: O1, campaignId: "7", campaignName: "Seven", state: "open", round: 1, messageCount: 1, ignoredMessages: 1, last: { from: "merchant", action: "propose", bps: 800 } });
  });
  it("lists a merchant's threads by on-chain merchant, and nothing for someone else", async () => {
    const mine = (await app().inject(`/agents/threads?principal=${M}&role=merchant`)).json();
    expect(mine.map((t: { offerKey: string }) => t.offerKey)).toEqual([O1]);
    const other = (await app().inject(`/agents/threads?principal=${M2}&role=merchant`)).json();
    expect(other.map((t: { offerKey: string }) => t.offerKey)).toEqual([O2]);
    const none = (await app().inject(`/agents/threads?principal=0x00000000000000000000000000000000000000e9&role=merchant`)).json();
    expect(none).toEqual([]);
  });
  it("shows an offer with no messages yet as open at round 0, and rejects bad input", async () => {
    const r = (await app().inject(`/agents/threads?principal=${C2}&role=creator`)).json();
    expect(r[0]).toMatchObject({ offerKey: O2, state: "open", round: 0, messageCount: 0 });
    expect((await app().inject("/agents/threads?principal=nope&role=creator")).statusCode).toBe(400);
    expect((await app().inject(`/agents/threads?principal=${C}&role=admin`)).statusCode).toBe(400);
  });
});

describe("GET /agents/binding", () => {
  it("reports bound=true only when a live binding names the API's agent wallet", async () => {
    const yes = (await app().inject(`/agents/binding?principal=${M}&role=merchant`)).json();
    expect(yes).toMatchObject({ enabled: true, agentAddress: AGENT, bound: true });
    const no = (await app().inject(`/agents/binding?principal=${C}&role=creator`)).json();
    expect(no).toMatchObject({ bound: false, bindings: [] });
  });
  it("a binding to some other wallet does not count; disabled agents report enabled=false", async () => {
    const other = "0x00000000000000000000000000000000000000ee" as Address;
    const r = (await app(other).inject(`/agents/binding?principal=${M}&role=merchant`)).json();
    expect(r.bound).toBe(false);
    const off = (await app(null).inject(`/agents/binding?principal=${M}&role=merchant`)).json();
    expect(off).toMatchObject({ enabled: false, agentAddress: null, bound: false });
  });
});

describe("policy auth uses the shared message", () => {
  it("a policy signed with @numa/shared's policyAuthMessage is accepted by the API", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const policy = { principal: acct.address, role: "creator", enabled: true, limitBps: 1000, openingBps: 0, autoAcceptBps: 1400, stepBps: 200, maxRounds: 5, categories: [] };
    const issuedAt = 1_000;
    const signature = await acct.signMessage({ message: policyAuthMessage("write", acct.address, "creator", issuedAt, policy) });
    const a = app();
    const ok = await a.inject({ method: "POST", url: "/agents/policy", payload: { policy, issuedAt, signature } });
    expect(ok.statusCode).toBe(200);
    // the same policy with keys in a different order still verifies (canonical JSON)
    const reordered = Object.fromEntries(Object.entries(policy).reverse());
    const sig2 = await acct.signMessage({ message: policyAuthMessage("write", acct.address, "creator", issuedAt, reordered) });
    expect((await a.inject({ method: "POST", url: "/agents/policy", payload: { policy: reordered, issuedAt, signature: sig2 } })).statusCode).toBe(200);
    const bad = await a.inject({ method: "POST", url: "/agents/policy", payload: { policy: { ...policy, limitBps: 900 }, issuedAt, signature } });
    expect(bad.statusCode).toBe(401);
  });
});

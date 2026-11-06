import { describe, expect, it, vi } from "vitest";
import { expiries, listCampaigns, listConversions, listLiveOffers, listOffers, topConversions, publishLink, publishOffer, resolveLink, type ArkivReader, type ArkivWriter } from "../src/index.js";

const creator = "0x2222222222222222222222222222222222222222" as const;
const writer = "0x4444444444444444444444444444444444444444" as const;

/** Recording fake of the SDK's select().from().where().ownedBy().limit().offset().fetch() chain. */
function fakeReader(entities: unknown[] = []) {
  const calls: Record<string, unknown[]> = {};
  const b: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "ownedBy", "limit", "offset", "orderBy"]) {
    b[m] = (...a: unknown[]) => { (calls[m] ??= []).push(a); return b; };
  }
  b.fetch = async () => ({ entities, skipped: 0 });
  return { reader: b as unknown as ArkivReader, calls };
}
const fakeWriter = () => {
  const createEntity = vi.fn().mockResolvedValue({ entityKey: "0xkey", txHash: "0xtx" });
  return { w: { createEntity } as unknown as ArkivWriter, createEntity };
};

describe("expiries", () => {
  const now = 1_000_000;
  it("campaign = end + 7d, accepted within the chain maximum", () => {
    expect(() => expiries.campaign(now + 30 * 86400, now)).not.toThrow();
  });
  it("rejects campaigns that would exceed ~182 days after the 7d grace", () => {
    expect(() => expiries.campaign(now + 180 * 86400, now)).toThrow(/maximum/);
  });
  it("rejects a decision expiry in the past", () => {
    expect(() => expiries.decision(now - 10, now)).toThrow(/past/);
  });
});

describe("ownership-checked reads", () => {
  it("resolveLink filters by expected creator and returns undefined when absent", async () => {
    const { reader, calls } = fakeReader([]);
    const r = await resolveLink(reader, { code: "abcd", campaignId: 7n, expectedCreator: creator });
    expect(r).toBeUndefined();
    expect(calls.ownedBy).toEqual([[creator]]);
  });
  it("resolveLink returns the link when the creator owns it", async () => {
    const { reader } = fakeReader([{ $key: "0xk", $owner: creator, code: { value: "abcd" }, campaignId: { value: 7n } }]);
    expect(await resolveLink(reader, { code: "abcd", campaignId: 7n, expectedCreator: creator })).toMatchObject({ creator, code: "abcd" });
  });
  it("listConversions only reads entities owned by the Numa writer", async () => {
    const { reader, calls } = fakeReader([]);
    await listConversions(reader, { creator, writer });
    expect(calls.ownedBy).toEqual([[writer]]);
  });
  it("listCampaigns applies pagination", async () => {
    const { reader, calls } = fakeReader([]);
    await listCampaigns(reader, { category: "food", limit: 10, offset: 20 });
    expect(calls.limit).toEqual([[10]]);
    expect(calls.offset).toEqual([[20]]);
  });
});

describe("writes", () => {
  it("rejects malformed link codes without sending a tx", async () => {
    const { w, createEntity } = fakeWriter();
    await expect(publishLink(w, { code: "a b", campaignId: 1n, days: 30 })).rejects.toThrow(/link code/);
    expect(createEntity).not.toHaveBeenCalled();
  });
  it("publishOffer creates one entity with an expiration", async () => {
    const { w, createEntity } = fakeWriter();
    await publishOffer(w, { campaignId: 1n, channel: "youtube", audience: "devs", askBps: 800, expectedReach: 1000n });
    expect(createEntity).toHaveBeenCalledOnce();
    expect(createEntity.mock.calls[0]![2]).toHaveProperty("expiration");
  });
});

describe("discovery queries", () => {
  it("listCampaigns sorts by commission desc or end date asc when asked", async () => {
    const a = fakeReader([]);
    await listCampaigns(a.reader, { sort: "commission" });
    expect(a.calls.orderBy).toHaveLength(1);
    const b = fakeReader([]);
    await listCampaigns(b.reader, { sort: "endingSoon" });
    expect(b.calls.orderBy).toHaveLength(1);
    const c = fakeReader([]);
    await listCampaigns(c.reader, {});
    expect(c.calls.orderBy).toBeUndefined();
  });
  it("topConversions is owner-filtered to the writer and sorts by gross", async () => {
    const { reader, calls } = fakeReader([]);
    await topConversions(reader, { writer, campaignId: 7n, sinceUnix: 1000, limit: 10 });
    expect(calls.ownedBy).toEqual([[writer]]);
    expect(calls.orderBy).toHaveLength(1);
    expect(calls.limit).toEqual([[10]]);
  });
  it("listLiveOffers pages until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ $key: `0x${i}`, $owner: creator, campaignId: { value: 1n }, askBps: { value: 500n } }));
    let call = 0;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "from", "orderBy", "limit", "offset"]) b[m] = () => b;
    b.fetch = async () => ({ entities: call++ === 0 ? full : full.slice(0, 3), skipped: 0 });
    const out = await listLiveOffers(b as unknown as ArkivReader);
    expect(out).toHaveLength(103);
    expect(call).toBe(2);
  });
  it("listOffers passes offset and sorts by key for stable pages", async () => {
    const { reader, calls } = fakeReader([]);
    await listOffers(reader, 7n, 2, 4);
    expect(calls.offset).toEqual([[4]]);
    expect(calls.limit).toEqual([[2]]);
    expect(calls.orderBy).toHaveLength(1);
  });
});

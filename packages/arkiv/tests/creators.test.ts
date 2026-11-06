import { describe, expect, it, vi } from "vitest";
import { getProfile, listEndorsements, listInvitesFor, publishEndorsement, publishInvite, publishProfile, renewProfile, searchCreators, setProfileAvailability, type ArkivReader, type ArkivWriter } from "../src/index.js";

const creator = "0x2222222222222222222222222222222222222222" as const;
const hex = (n: string) => `0x${n.repeat(32)}` as const;

function fakeReader(entities: unknown[] = []) {
  const calls: Record<string, unknown[]> = {};
  const b: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "ownedBy", "limit", "offset", "orderBy"]) b[m] = (...a: unknown[]) => { (calls[m] ??= []).push(a); return b; };
  b.fetch = async () => ({ entities, skipped: 0 });
  return { reader: b as unknown as ArkivReader, calls };
}
const fakeWriter = () => {
  const createEntity = vi.fn().mockResolvedValue({ entityKey: "0xkey", txHash: "0xtx" });
  const patchEntity = vi.fn().mockResolvedValue({});
  const extendEntity = vi.fn().mockResolvedValue({ entityKey: "0xkey", txHash: "0xtx", expiresAt: 1n });
  return { w: { createEntity, patchEntity, extendEntity } as unknown as ArkivWriter, createEntity, patchEntity, extendEntity };
};
const profile = { displayName: "Ada", bio: "devtools", niche: "devtools", channel: "youtube", handle: "https://y.t/ada", minAskBps: 500, open: true };

describe("profiles", () => {
  it("validates input before sending a tx", async () => {
    const { w, createEntity } = fakeWriter();
    await expect(publishProfile(w, { ...profile, niche: "Dev Tools" })).rejects.toThrow(/niche/);
    await expect(publishProfile(w, { ...profile, minAskBps: 5001 })).rejects.toThrow(/minAskBps/);
    await expect(publishProfile(w, { ...profile, displayName: "" })).rejects.toThrow(/displayName/);
    await expect(publishProfile(w, { ...profile, bio: "x".repeat(501) })).rejects.toThrow(/bio/);
    expect(createEntity).not.toHaveBeenCalled();
  });
  it("publishes with a 90 day expiration, patches availability, renews", async () => {
    const { w, createEntity, patchEntity, extendEntity } = fakeWriter();
    await publishProfile(w, { ...profile, niches: ["ai", "web3"] });
    expect(createEntity.mock.calls[0]![2]).toHaveProperty("expiration");
    await setProfileAvailability(w, "0xkey", { open: false, minAskBps: 800 });
    expect(patchEntity).toHaveBeenCalledOnce();
    await renewProfile(w, "0xkey");
    expect(extendEntity.mock.calls[0]![0]).toMatchObject({ entityKey: "0xkey" });
  });
  it("getProfile is filtered to the creator's own wallet", async () => {
    const { reader, calls } = fakeReader([]);
    expect(await getProfile(reader, creator)).toBeUndefined();
    expect(calls.ownedBy).toEqual([[creator]]);
  });
  it("searchCreators maps rows and paginates; defaults to open creators only", async () => {
    const row = { $key: "0xk", $owner: creator, displayName: { value: "Ada" }, bio: { value: "b" }, niche: { value: "devtools" }, niches: { value: "ai,web3" }, channel: { value: "youtube" }, handle: { value: "h" }, minAskBps: { value: 500n }, open: { value: true } };
    const { reader, calls } = fakeReader([row]);
    const out = await searchCreators(reader, { niche: "devtools", maxAskBps: 800, limit: 5, offset: 10 });
    expect(out[0]).toMatchObject({ creator, niche: "devtools", niches: ["ai", "web3"], minAskBps: 500, open: true });
    expect(calls.where).toHaveLength(1);
    expect(calls.limit).toEqual([[5]]);
    expect(calls.offset).toEqual([[10]]);
  });
});

describe("invites and endorsements", () => {
  it("validates invites", async () => {
    const { w, createEntity } = fakeWriter();
    await expect(publishInvite(w, { campaignId: 1n, creator, offeredBps: 0, message: "" })).rejects.toThrow(/offeredBps/);
    await expect(publishInvite(w, { campaignId: 1n, creator, offeredBps: 500, message: "x".repeat(281) })).rejects.toThrow(/message/);
    await publishInvite(w, { campaignId: 1n, creator, offeredBps: 500, message: "join us" });
    expect(createEntity).toHaveBeenCalledOnce();
  });
  it("lists invites for a creator and exposes the (untrusted) merchant owner", async () => {
    const { reader } = fakeReader([{ $key: "0xk", $owner: "0xmerchant", campaignId: { value: 7n }, creator: { value: creator }, offeredBps: { value: 600n }, message: { value: "hi" } }]);
    expect(await listInvitesFor(reader, creator)).toEqual([{ entityKey: "0xk", merchant: "0xmerchant", campaignId: 7n, creator, offeredBps: 600, message: "hi" }]);
  });
  it("validates endorsement rating and note, then publishes", async () => {
    const { w, createEntity } = fakeWriter();
    const base = { creator, campaignId: 7n, orderId: hex("0a"), txHash: hex("0b"), note: "great" };
    for (const rating of [0, 6, 2.5]) await expect(publishEndorsement(w, { ...base, rating })).rejects.toThrow(/rating/);
    await publishEndorsement(w, { ...base, rating: 5 });
    expect(createEntity).toHaveBeenCalledOnce();
  });
  it("lists endorsements with author, rating and tx", async () => {
    const { reader } = fakeReader([{ $key: "0xk", $owner: "0xmerchant", creator: { value: creator }, campaignId: { value: 7n }, orderId: { value: hex("0a") }, txHash: { value: hex("0b") }, rating: { value: 4n }, note: { value: "n" } }]);
    expect((await listEndorsements(reader, creator))[0]).toMatchObject({ merchant: "0xmerchant", rating: 4, txHash: hex("0b") });
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_CAMPAIGN_DAYS,
  emptyCampaign,
  emptyProfile,
  makeLinkStore,
  slugify,
  suggestLinkCode,
  trackerUrl,
  validateCampaign,
  validateLink,
  validateOffer,
  validateProfile,
  LINK_CODE,
} from "./entityForms";

const ADDR = "0x1111111111111111111111111111111111111111";
const NOW = 1_800_000_000;

describe("slugify", () => {
  it("makes lowercase dashed slugs and bounds the length", () => {
    expect(slugify("  Short Video!  ")).toBe("short-video");
    expect(slugify("A".repeat(60))).toHaveLength(32);
    expect(slugify("---")).toBe("");
  });
});

describe("validateProfile (mirrors @numa/arkiv checkProfile)", () => {
  const ok = { ...emptyProfile(), displayName: "Rio Santos", niche: "Streetwear", channel: "YouTube", niches: "Running, photography", minAsk: "12.5" };
  it("accepts a complete profile and normalises slugs and percent to basis points", () => {
    const r = validateProfile(ok);
    expect(r).toEqual({ ok: true, value: { displayName: "Rio Santos", bio: "", niche: "streetwear", niches: ["running", "photography"], channel: "youtube", handle: "", minAskBps: 1250, open: true } });
  });
  it("rejects each bad field with a readable message", () => {
    for (const [k, v] of [["displayName", ""], ["displayName", "x".repeat(61)], ["bio", "x".repeat(501)], ["niche", "!"], ["channel", ""], ["minAsk", "51"], ["minAsk", "abc"], ["niches", "a"]] as const) {
      const r = validateProfile({ ...ok, [k]: v });
      expect(r.ok, `${k}=${v}`).toBe(false);
      if (!r.ok) expect(r.errors[k]).toBeTruthy();
    }
  });
});

describe("validateOffer", () => {
  const f = { channel: "short-video", audience: "night runners who buy shoes", askPct: 15, reach: "12000" };
  it("accepts a valid offer and converts to basis points and bigint reach", () => {
    expect(validateOffer(f, 2000)).toEqual({ ok: true, value: { channel: "short-video", audience: "night runners who buy shoes", askBps: 1500, expectedReach: 12000n } });
  });
  it("never lets the ask exceed what the campaign pays", () => {
    const r = validateOffer({ ...f, askPct: 21 }, 2000);
    expect(!r.ok && r.errors.askPct).toMatch(/at most 20%/);
    expect(validateOffer({ ...f, askPct: 20 }, 2000).ok).toBe(true);
  });
  it("refuses vague audiences, missing channels and bad reach", () => {
    expect(validateOffer({ ...f, audience: "everyone" }, 2000).ok).toBe(false);
    expect(validateOffer({ ...f, channel: "" }, 2000).ok).toBe(false);
    expect(validateOffer({ ...f, reach: "-1" }, 2000).ok).toBe(false);
    expect(validateOffer({ ...f, reach: "1.5" }, 2000).ok).toBe(false);
    expect(validateOffer({ ...f, askPct: 0 }, 2000).ok).toBe(false);
  });
});

describe("links", () => {
  it("validates the code and caps the lifetime at the campaign's", () => {
    expect(validateLink({ code: "RIO-08-X", days: "7" }, 30).ok).toBe(true);
    expect(validateLink({ code: "abc", days: "7" }, 30).ok).toBe(false);
    expect(validateLink({ code: "has space", days: "7" }, 30).ok).toBe(false);
    const r = validateLink({ code: "RIO-08-X", days: "31" }, 30);
    expect(!r.ok && r.errors.days).toMatch(/ends in 30 days/);
    expect(validateLink({ code: "RIO-08-X", days: "0" }, 30).ok).toBe(false);
  });
  it("suggests codes that always pass the rule, with no look-alike characters", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 200; i++) {
      const c = suggestLinkCode(rnd);
      expect(c).toMatch(LINK_CODE);
      expect(c).not.toMatch(/[01OI]/);
    }
  });
  it("builds the tracker URL for a relative or absolute API base", () => {
    expect(trackerUrl("ABC123", "https://shop.test", "/api")).toBe("https://shop.test/api/r/ABC123");
    expect(trackerUrl("ABC123", "https://shop.test", "https://api.numa.test")).toBe("https://api.numa.test/r/ABC123");
  });
});

describe("saved links (public codes, kept in this browser)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("adds newest first, de-duplicates by code, and is per wallet", () => {
    const s = makeLinkStore(mem());
    s.add(ADDR, { code: "AAAA1111", campaignId: "7", days: 7, createdAt: 1 });
    s.add(ADDR, { code: "BBBB2222", campaignId: "7", days: 7, createdAt: 2 });
    s.add(ADDR, { code: "AAAA1111", campaignId: "7", days: 9, createdAt: 3 });
    expect(s.list(ADDR).map((l) => l.code)).toEqual(["AAAA1111", "BBBB2222"]);
    expect(s.list("0x" + "2".repeat(40))).toEqual([]);
    expect(s.list(ADDR.toUpperCase().replace("0X", "0x"))).toHaveLength(2); // address case doesn't matter
  });
  it("survives corrupt, hostile or unavailable storage", () => {
    const bad = { getItem: () => '[{"code":"<script>","campaignId":"x"},{"code":"GOOD1234","campaignId":"7","days":1,"createdAt":1},5]', setItem: () => { throw new Error("full"); } };
    const s = makeLinkStore(bad);
    expect(s.list(ADDR).map((l) => l.code)).toEqual(["GOOD1234"]); // invalid entries dropped
    expect(() => s.add(ADDR, { code: "NEW12345", campaignId: "7", days: 1, createdAt: 1 })).not.toThrow();
    expect(makeLinkStore(undefined).list(ADDR)).toEqual([]);
    expect(makeLinkStore({ getItem: () => "not json", setItem: () => undefined }).list(ADDR)).toEqual([]);
  });
});

describe("validateCampaign (contracts + Arkiv limits)", () => {
  const f = { ...emptyCampaign(ADDR), name: "NO SLEEP / DROP 08", category: "Streetwear", commission: "18", days: "30" };
  it("accepts a valid campaign and computes the on-chain arguments", () => {
    const r = validateCampaign(f, NOW);
    expect(r).toEqual({ ok: true, value: { payoutSigner: ADDR, commissionBps: 1800, endsAt: NOW + 30 * 86400, listing: { name: "NO SLEEP / DROP 08", description: "", category: "streetwear", region: "global" } } });
  });
  it("enforces the 50% cap, a positive commission and a valid signer", () => {
    expect(validateCampaign({ ...f, commission: "50" }, NOW).ok).toBe(true);
    expect(validateCampaign({ ...f, commission: "50.01" }, NOW).ok).toBe(false);
    expect(validateCampaign({ ...f, commission: "0" }, NOW).ok).toBe(false);
    expect(validateCampaign({ ...f, payoutSigner: "0x123" }, NOW).ok).toBe(false);
    expect(validateCampaign({ ...f, payoutSigner: "" }, NOW).ok).toBe(false);
  });
  it("keeps the campaign inside what Arkiv can list (end + 7 days <= ~182 days)", () => {
    expect(validateCampaign({ ...f, days: String(MAX_CAMPAIGN_DAYS) }, NOW).ok).toBe(true);
    const r = validateCampaign({ ...f, days: String(MAX_CAMPAIGN_DAYS + 1) }, NOW);
    expect(!r.ok && r.errors.days).toMatch(/182/);
    expect(MAX_CAMPAIGN_DAYS + 7).toBeLessThanOrEqual(182);
    expect(validateCampaign({ ...f, days: "0" }, NOW).ok).toBe(false);
  });
  it("requires a name and category, and bounds the text", () => {
    expect(validateCampaign({ ...f, name: "" }, NOW).ok).toBe(false);
    expect(validateCampaign({ ...f, name: "x".repeat(81) }, NOW).ok).toBe(false);
    expect(validateCampaign({ ...f, category: "" }, NOW).ok).toBe(false);
    expect(validateCampaign({ ...f, description: "x".repeat(281) }, NOW).ok).toBe(false);
  });
});

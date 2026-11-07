import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getJson } from "./client";
import { addressUrl, ago, bpsToPercent, formatUsdt, salesToCsv, shortAddress, timeLeft, txUrl } from "./format";
import { demoCampaigns, demoCreatorCard, demoLeaderboard, demoTrending } from "./mock";
import { toCampaignView } from "./view";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("formatUsdt (base units, 6 dp, never floats)", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatUsdt("8420000000")).toBe("8,420.00");
    expect(formatUsdt("1477800000")).toBe("1,477.80");
    expect(formatUsdt(0n)).toBe("0.00");
    expect(formatUsdt("1")).toBe("0.00");
  });
  it("truncates instead of rounding up", () => {
    expect(formatUsdt("1999999")).toBe("1.99");
    expect(formatUsdt("1999999", 6)).toBe("1.999999");
  });
  it("supports zero decimals and negatives", () => {
    expect(formatUsdt("8420999999", 0)).toBe("8,420");
    expect(formatUsdt("-2500000")).toBe("-2.50");
  });
  it("does not throw on garbage", () => {
    expect(formatUsdt("not a number")).toBe("—");
  });
  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(formatUsdt("123456789012345678901234567890")).toBe("123,456,789,012,345,678,901,234.56");
  });
});

describe("display helpers", () => {
  it("shortens addresses and builds explorer links", () => {
    expect(shortAddress("0x71c9d8f03a00000000000000000000000000d03a")).toBe("0x71c9…d03a");
    expect(shortAddress("0x12")).toBe("0x12");
    expect(txUrl("0xabc")).toBe("https://explorer.testnet.whitechain.io/tx/0xabc");
    expect(addressUrl("0xabc")).toBe("https://explorer.testnet.whitechain.io/address/0xabc");
  });
  it("converts basis points to percent", () => {
    expect(bpsToPercent(1800)).toBe("18%");
    expect(bpsToPercent(1250)).toBe("12.5%");
    expect(bpsToPercent(125)).toBe("1.25%");
    expect(bpsToPercent(5000)).toBe("50%");
  });
  it("formats countdowns and relative times", () => {
    const now = 1_000_000;
    expect(timeLeft(now + 2 * 86400 + 14 * 3600, now)).toBe("2d 14h");
    expect(timeLeft(now + 18 * 3600 + 9 * 60, now)).toBe("18h 09m");
    expect(timeLeft(now + 90, now)).toBe("1m");
    expect(timeLeft(now - 1, now)).toBe("ended");
    expect(ago(now - 120, now)).toBe("2m ago");
    expect(ago(now - 3 * 3600, now)).toBe("3h ago");
    expect(ago(now - 100_000, now)).toBe("yesterday");
    expect(ago(now - 5 * 86400, now)).toBe("5d ago");
  });
});

describe("getJson error classification", () => {
  it("returns parsed JSON on success", async () => {
    const f = vi.fn().mockResolvedValue(json([{ ok: 1 }]));
    expect(await getJson("/x", { base: "/api", fetchImpl: f })).toEqual([{ ok: 1 }]);
    expect(f.mock.calls[0][0]).toBe("/api/x");
  });
  it("flags HTTP errors with their status (404 = discovery routes not enabled)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(getJson("/x", { fetchImpl: f })).rejects.toMatchObject({ kind: "http", status: 404 });
  });
  it("treats an HTML response as 'API not there' (dev server fallback page)", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    await expect(getJson("/x", { fetchImpl: f })).rejects.toMatchObject({ kind: "shape" });
  });
  it("flags network failures", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(getJson("/x", { fetchImpl: f })).rejects.toMatchObject({ kind: "network" });
  });
  it("times out a hung API", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    );
    const p = getJson("/x", { fetchImpl: f as unknown as typeof fetch });
    const assertion = expect(p).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(6100);
    await assertion;
  });
  it("does not mask a caller's own cancellation as an API failure", async () => {
    const ctrl = new AbortController();
    const f = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    );
    const p = getJson("/x", { fetchImpl: f as unknown as typeof fetch, signal: ctrl.signal });
    ctrl.abort("navigated away");
    const err = await p.catch((e) => e);
    expect(err).not.toBeInstanceOf(ApiError);
  });
});

describe("api endpoints", () => {
  it("builds query strings and omits unset filters", async () => {
    const f = vi.fn((_url: string) => Promise.resolve(json([]))); // a fresh Response per call: bodies are single-use
    vi.stubGlobal("fetch", f);
    await api.campaigns({ category: "music", minCommissionBps: 1000, region: undefined, limit: 100 });
    expect(f.mock.calls[0][0]).toBe("/api/discovery/campaigns?category=music&minCommissionBps=1000&limit=100");
    await api.leaderboard({ campaignId: "8", days: 30, limit: 20 });
    expect(f.mock.calls[1][0]).toBe("/api/discovery/leaderboard?campaignId=8&days=30&limit=20");
    await api.creator("0xabc");
    expect(f.mock.calls[2][0]).toBe("/api/creators/0xabc");
  });
});

describe("view adapters and demo fixtures", () => {
  it("maps merchantVerified null to 'unchecked', never 'verified'", () => {
    const [a, b, c] = demoCampaigns();
    expect(toCampaignView({ ...a, merchantVerified: true }).verified).toBe("verified");
    expect(toCampaignView({ ...b, merchantVerified: false }).verified).toBe("unverified");
    expect(toCampaignView({ ...c, merchantVerified: null }).verified).toBe("unchecked");
  });
  it("converts commission bps to percent and falls back to a name", () => {
    const v = toCampaignView({ ...demoCampaigns()[0], name: "", commissionBps: 1250 }, 7);
    expect(v.commission).toBe(12.5);
    expect(v.commissionLabel).toBe("12.5%");
    expect(v.name).toBe("Campaign #8");
    expect(v.offers).toBe(7);
  });
  it("keeps demo fixtures well-formed", () => {
    expect(demoTrending()[0].offerCount).toBeGreaterThanOrEqual(demoTrending()[1].offerCount);
    const lb = demoLeaderboard();
    expect(lb.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    for (const r of lb) expect(r.creator).toMatch(/^0x[0-9a-f]{40}$/);
    const card = demoCreatorCard();
    expect(card.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(card.reputation.score).toBeGreaterThanOrEqual(0);
    expect(card.reputation.score).toBeLessThanOrEqual(100);
  });
});

describe("salesToCsv", () => {
  const sale = { txHash: "0xabc", campaignId: "7", gross: "25000000", commission: "4500000", status: "held", paidAt: 1_800_000_000 };
  it("writes a header and one row per sale, with exact 6-decimal amounts", () => {
    const lines = salesToCsv([sale]).trimEnd().split("\n");
    expect(lines[0]).toBe("txHash,campaignId,grossUsdt,commissionUsdt,status,paidAtUtc");
    expect(lines[1]).toBe("0xabc,7,25.000000,4.500000,held,2027-01-15T08:00:00.000Z");
  });
  it("is just a header for no sales, and ends with a newline", () => {
    expect(salesToCsv([])).toBe("txHash,campaignId,grossUsdt,commissionUsdt,status,paidAtUtc\n");
  });
  it("quotes fields that contain commas, quotes or newlines (no CSV injection of columns)", () => {
    const csv = salesToCsv([{ ...sale, status: 'he said "hi", ok\nnext' }]);
    expect(csv).toContain('"he said ""hi"", ok\nnext"');
  });
});

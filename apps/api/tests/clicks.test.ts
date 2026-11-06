import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { describe, expect, it, vi } from "vitest";
import { registerClickRoutes, type ClickDeps } from "../src/routes/clicks.js";
import { MemoryClickStore, visitorHash } from "../src/services/clicks.js";

const creator = "0x2222222222222222222222222222222222222222" as const;

async function app(over: Partial<ClickDeps> = {}) {
  const a = Fastify();
  await a.register(rateLimit, { max: 5, timeWindow: "1 minute" }); // strict global limit, like /relay
  registerClickRoutes(a, { clicks: new MemoryClickStore(), checkoutBaseUrl: "https://shop.example/", clickRateLimitPerMinute: 1000, visitorSecret: "s", ...over });
  return a;
}

describe("click tracker", () => {
  it("redirects to checkout and counts clicks", async () => {
    const a = await app();
    const r = await a.inject("/r/abcd1234");
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("https://shop.example/checkout/abcd1234");
    expect((await a.inject("/links/abcd1234/stats")).json()).toMatchObject({ clicks: 1, uniqueVisitors: 1, settled: null });
  });
  it("counts 500 bot clicks despite the strict global limit (bots must be counted, not blocked) and counts unique visitors", async () => {
    const a = await app();
    const codes = await Promise.all(Array.from({ length: 500 }, (_, i) => a.inject({ url: "/r/botlink1", headers: { "user-agent": `bot-${i % 20}` } })));
    expect(codes.every((r) => r.statusCode === 302)).toBe(true);
    expect((await a.inject("/links/botlink1/stats")).json()).toMatchObject({ clicks: 500, uniqueVisitors: 20 });
  });
  it("rejects malformed codes without recording", async () => {
    const clicks = new MemoryClickStore();
    const a = await app({ clicks });
    for (const code of ["ab", "has space", "x".repeat(40), "a%2Fb%2Fc%2Fd"]) expect((await a.inject(`/r/${encodeURIComponent(code)}`)).statusCode).toBe(400);
    expect(await clicks.stats("ab")).toEqual({ clicks: 0, uniqueVisitors: 0 });
  });
  it("stats show 500 clicks beside $0 commission, and require the link to be owned by the claimed creator", async () => {
    const owned = vi.fn().mockResolvedValue(true);
    const settled = vi.fn().mockResolvedValue({ verifiedConversions: 0, grossSettled: 0n, commissionEarned: 0n });
    const a = await app({ linkOwnedBy: owned, settledFor: settled });
    for (let i = 0; i < 3; i++) await a.inject("/r/linkcode");
    const body = (await a.inject(`/links/linkcode/stats?creator=${creator}&campaignId=7`)).json();
    expect(body).toMatchObject({ clicks: 3, settled: { verifiedConversions: 0, grossSettled: "0", commissionEarned: "0" } });
    expect(settled).toHaveBeenCalledWith({ creator, campaignId: 7n });

    const stranger = await app({ linkOwnedBy: vi.fn().mockResolvedValue(false), settledFor: settled });
    expect((await stranger.inject(`/links/linkcode/stats?creator=${creator}&campaignId=7`)).statusCode).toBe(404);
  });
  it("validates stats query parameters", async () => {
    const a = await app({ linkOwnedBy: vi.fn(), settledFor: vi.fn() });
    expect((await a.inject("/links/linkcode/stats?creator=nope&campaignId=7")).statusCode).toBe(400);
    expect((await a.inject(`/links/linkcode/stats?creator=${creator}`)).statusCode).toBe(400);
  });
  it("visitor hash never contains the ip and rotates daily", () => {
    const h1 = visitorHash("203.0.113.9", "ua", "2026-11-07", "s");
    expect(h1).not.toContain("203.0.113.9");
    expect(h1).toHaveLength(16);
    expect(visitorHash("203.0.113.9", "ua", "2026-11-08", "s")).not.toBe(h1);
  });
});

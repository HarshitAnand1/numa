import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerCors } from "../src/routes/cors.js";
import { registerDiscoveryRoutes } from "../src/routes/discovery.js";

describe("CORS", () => {
  const build = (origins: string[]) => {
    const a = Fastify();
    registerCors(a, origins);
    a.get("/x", async () => ({ ok: true }));
    return a;
  };
  it("reflects an allowed origin and answers preflight", async () => {
    const a = build(["https://numa.app"]);
    const r = await a.inject({ method: "GET", url: "/x", headers: { origin: "https://numa.app" } });
    expect(r.headers["access-control-allow-origin"]).toBe("https://numa.app");
    const p = await a.inject({ method: "OPTIONS", url: "/x", headers: { origin: "https://numa.app" } });
    expect(p.statusCode).toBe(204);
  });
  it("sends no CORS headers to a disallowed origin", async () => {
    const r = await build(["https://numa.app"]).inject({ method: "GET", url: "/x", headers: { origin: "https://evil.example" } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("discovery timeout", () => {
  it("returns 504 instead of hanging when Arkiv stalls", async () => {
    const a = Fastify();
    const b: Record<string, unknown> = {};
    b.select = () => b; b.from = () => b;
    for (const m of ["where", "ownedBy", "limit", "offset", "orderBy"]) b[m] = () => b;
    b.fetch = () => new Promise(() => {});
    const stalled = b;
    registerDiscoveryRoutes(a, { arkiv: stalled as never, pub: {} as never, router: "0x0000000000000000000000000000000000000001", writer: "0x0000000000000000000000000000000000000002", timeoutMs: 50 });
    const r = await a.inject("/discovery/campaigns");
    expect(r.statusCode).toBe(504);
    expect(r.json().error).toBe("UPSTREAM_TIMEOUT");
  });
});

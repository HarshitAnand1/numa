import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
// The backend's own validator and signature check: the source of truth these must agree with.
import { parsePolicy, verifyPolicyAuth } from "../../../api/src/agents/policy";
import { PolicyApiError, readPolicy, savePolicy } from "./agentsApi";
import {
  bpsToPct,
  defaultForm,
  formFromPolicy,
  parseCategories,
  pctToBps,
  readRequest,
  toBody,
  validateForm,
  writeRequest,
  type AgentRole,
  type PolicyBody,
  type PolicyForm,
} from "./policyForm";

const account = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
const other = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const NOW = 1_800_000_000;

describe("percent <-> basis points (exact integers, no floats)", () => {
  it("converts plain percents", () => {
    expect(pctToBps("12")).toBe(1200);
    expect(pctToBps("12.5")).toBe(1250);
    expect(pctToBps("0.1")).toBe(10);
    expect(pctToBps("0.05")).toBe(5);
    expect(pctToBps("50")).toBe(5000);
    expect(pctToBps(" 7 ")).toBe(700);
  });
  it("rejects anything that is not a plain percent", () => {
    for (const bad of ["", "-1", "1e2", "abc", "1.234", ".5", "5.", "1,5", "1 2", "1000"]) expect(pctToBps(bad), bad).toBeNull();
  });
  it("round-trips every value the form can produce", () => {
    for (let bps = 0; bps <= 5000; bps += 5) expect(pctToBps(bpsToPct(bps)), String(bps)).toBe(bps);
  });
});

describe("validateForm", () => {
  it("accepts the defaults for both roles", () => {
    expect(validateForm("creator", defaultForm("creator")).ok).toBe(true);
    expect(validateForm("merchant", defaultForm("merchant")).ok).toBe(true);
  });
  it("creator: auto-accept must be at or above the floor", () => {
    const f = { ...defaultForm("creator"), limit: "15", autoAccept: "14" };
    const v = validateForm("creator", f);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.errors.autoAccept).toMatch(/floor/);
  });
  it("merchant: opening and auto-accept must be at or below the ceiling", () => {
    const m = defaultForm("merchant");
    const a = validateForm("merchant", { ...m, opening: "30" });
    const b = validateForm("merchant", { ...m, autoAccept: "30" });
    expect(!a.ok && a.errors.opening).toMatch(/ceiling/);
    expect(!b.ok && b.errors.autoAccept).toMatch(/ceiling/);
  });
  it("enforces the hard caps (50% commission, step 0.1%-10%, 1-10 rounds)", () => {
    const m = defaultForm("merchant");
    expect(validateForm("merchant", { ...m, limit: "51" }).ok).toBe(false);
    expect(validateForm("merchant", { ...m, step: "0.05" }).ok).toBe(false);
    expect(validateForm("merchant", { ...m, step: "11" }).ok).toBe(false);
    expect(validateForm("merchant", { ...m, maxRounds: "0" }).ok).toBe(false);
    expect(validateForm("merchant", { ...m, maxRounds: "11" }).ok).toBe(false);
  });
  it("validates categories and ignores them for creators", () => {
    const m = defaultForm("merchant");
    expect(validateForm("merchant", { ...m, categories: "streetwear, music" }).ok).toBe(true);
    expect(validateForm("merchant", { ...m, categories: "Bad Category!" }).ok).toBe(false);
    expect(parseCategories("Streetwear , MUSIC,,")).toEqual(["streetwear", "music"]);
    const c = validateForm("creator", { ...defaultForm("creator"), categories: "anything goes !!" });
    expect(c.ok && c.body.categories).toEqual([]);
  });
  it("round-trips a saved policy back into the form", () => {
    const f = { ...defaultForm("merchant"), limit: "22.5", opening: "12.25", categories: "music" };
    const b = toBody(account.address, "merchant", f) as PolicyBody;
    expect(formFromPolicy(b)).toEqual({ ...f, opening: "12.25" });
  });
});

describe("parity with the backend validator (apps/api parsePolicy)", () => {
  it("agrees on accept/reject for 600 pseudo-random forms, and on the normalised policy when both accept", () => {
    let seed = 20261107;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pct = () => {
      const bps = [0, 5, 10, 100, 250, 1000, 1200, 1500, 1800, 2500, 4999, 5000, 5001, 6000][rnd(14)]! + (rnd(3) === 0 ? rnd(40) : 0);
      return bpsToPct(bps);
    };
    let accepted = 0;
    for (let i = 0; i < 600; i++) {
      const role: AgentRole = rnd(2) ? "creator" : "merchant";
      const f: PolicyForm = {
        enabled: !!rnd(2),
        limit: pct(),
        opening: role === "merchant" ? pct() : "",
        autoAccept: pct(),
        step: [ "0.05", "0.1", "1", "5", "10", "11", "0" ][rnd(7)]!,
        maxRounds: String(rnd(13)),
        categories: ["", "music", "streetwear, music", "Bad One", "a"][rnd(5)]!,
      };
      const mine = toBody(account.address, role, f);
      let theirs: ReturnType<typeof parsePolicy> | null = null;
      if (!("errors" in mine)) {
        try {
          theirs = parsePolicy(mine);
        } catch {
          theirs = null;
        }
        expect(theirs, `the form accepted ${JSON.stringify(f)} (${role}) but the backend refused it`).not.toBeNull();
        expect(theirs).toEqual({ ...mine, principal: getAddress(account.address) });
        accepted++;
      } else {
        // build the closest body the backend could see for the same input and confirm it refuses too
        const raw = {
          principal: account.address,
          role,
          enabled: f.enabled,
          limitBps: pctToBps(f.limit) ?? -1,
          openingBps: role === "merchant" ? (pctToBps(f.opening) ?? -1) : 0,
          autoAcceptBps: pctToBps(f.autoAccept) ?? -1,
          stepBps: pctToBps(f.step) ?? -1,
          maxRounds: /^\d{1,2}$/.test(f.maxRounds) ? Number(f.maxRounds) : -1,
          categories: role === "merchant" ? parseCategories(f.categories) : [],
        };
        expect(() => parsePolicy(raw), `the form refused ${JSON.stringify(f)} (${role}) but the backend accepted it`).toThrow();
      }
    }
    expect(accepted).toBeGreaterThan(30); // the grid really exercises the accepting path
  });
});

describe("signing: what the wallet signs is what the API verifies", () => {
  const body = (): PolicyBody => toBody(account.address, "creator", defaultForm("creator")) as PolicyBody;

  it("a write signature passes the backend's verifyPolicyAuth", async () => {
    const { message, payload } = writeRequest(body(), NOW);
    const signature = await account.signMessage({ message });
    expect(await verifyPolicyAuth({ action: "write", principal: account.address, role: "creator", issuedAt: payload.issuedAt, body: payload.policy, signature, now: NOW })).toBe(true);
  });
  it("a read signature passes, and a write signature cannot be replayed as a read", async () => {
    const r = readRequest(account.address, "creator", NOW);
    const sigRead = await account.signMessage({ message: r.message });
    expect(await verifyPolicyAuth({ action: "read", principal: account.address, role: "creator", issuedAt: NOW, signature: sigRead, now: NOW })).toBe(true);
    const w = writeRequest(body(), NOW);
    const sigWrite = await account.signMessage({ message: w.message });
    expect(await verifyPolicyAuth({ action: "read", principal: account.address, role: "creator", issuedAt: NOW, signature: sigWrite, now: NOW })).toBe(false);
  });
  it("is bound to the principal, the role, the exact body and the time", async () => {
    const { message, payload } = writeRequest(body(), NOW);
    const signature = await account.signMessage({ message });
    const base = { action: "write" as const, principal: account.address, role: "creator" as const, issuedAt: NOW, body: payload.policy, signature, now: NOW };
    expect(await verifyPolicyAuth({ ...base, principal: other.address })).toBe(false); // someone else
    expect(await verifyPolicyAuth({ ...base, role: "merchant" })).toBe(false); // other role
    expect(await verifyPolicyAuth({ ...base, body: { ...payload.policy, limitBps: 100 } })).toBe(false); // edited limits
    expect(await verifyPolicyAuth({ ...base, now: NOW + 301 })).toBe(false); // stale
    expect(await verifyPolicyAuth({ ...base, now: NOW + 299 })).toBe(true); // still inside the window
  });
  it("does not depend on key order in the signed body", async () => {
    const b = body();
    const { message } = writeRequest(b, NOW);
    const signature = await account.signMessage({ message });
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    expect(await verifyPolicyAuth({ action: "write", principal: account.address, role: "creator", issuedAt: NOW, body: reordered, signature, now: NOW })).toBe(true);
  });
  it("shows the wallet readable text that names the action, principal and role", () => {
    const { message } = writeRequest(body(), NOW);
    expect(message.split("\n").slice(0, 4)).toEqual(["numa-agent:v1", "action:write", `principal:${account.address.toLowerCase()}`, "role:creator"]);
  });
});

describe("policy API client", () => {
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const policy = toBody(account.address, "creator", defaultForm("creator")) as PolicyBody;

  it("posts the policy with the signature and issuedAt", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => ok({ ok: true, enabled: true }));
    await savePolicy({ policy, issuedAt: NOW }, "0xabc", f as never);
    expect(f.mock.calls[0]?.[0]).toBe("/api/agents/policy");
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ policy, issuedAt: NOW, signature: "0xabc" });
  });
  it("surfaces the API's own error code and message", async () => {
    const f = vi.fn(async () => ok({ error: "UNAUTHORIZED", message: "signature does not prove control" }, 401));
    const e = await savePolicy({ policy, issuedAt: NOW }, "0xabc", f as never).catch((x) => x);
    expect(e).toBeInstanceOf(PolicyApiError);
    expect(e).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });
  it("tells a missing policy (404) apart from a network failure", async () => {
    const nf = vi.fn(async () => ok({ error: "NOT_FOUND" }, 404));
    expect(await readPolicy({ principal: account.address, role: "creator", issuedAt: NOW }, "0xabc", nf as never).catch((x) => x)).toMatchObject({ code: "NOT_FOUND" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await readPolicy({ principal: account.address, role: "creator", issuedAt: NOW }, "0xabc", down as never).catch((x) => x)).toMatchObject({ code: "NETWORK" });
  });
});

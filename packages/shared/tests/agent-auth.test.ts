import { describe, expect, it } from "vitest";
import { canonicalJson, policyAuthMessage } from "../src/index.js";

describe("policyAuthMessage (shared by the browser and the API)", () => {
  it("matches the pinned format exactly", () => {
    const m = policyAuthMessage("write", "0xAbCdEf0000000000000000000000000000000001", "merchant", 1_800_000_000, { b: 2, a: [1, { d: 4, c: 3 }] });
    expect(m).toBe(
      'numa-agent:v1\naction:write\nprincipal:0xabcdef0000000000000000000000000000000001\nrole:merchant\nissuedAt:1800000000\nbody:{"a":[1,{"c":3,"d":4}],"b":2}',
    );
  });
  it("a read message carries a null body", () => {
    expect(policyAuthMessage("read", "0x0000000000000000000000000000000000000001", "creator", 1)).toMatch(/\nbody:null$/);
  });
  it("body key order does not change the text", () => {
    const a = { limitBps: 1000, role: "creator", categories: [] };
    const b = { categories: [], role: "creator", limitBps: 1000 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
  it("different action, role, principal or body gives different text", () => {
    const base = policyAuthMessage("write", "0x0000000000000000000000000000000000000001", "creator", 5, { x: 1 });
    expect(policyAuthMessage("read", "0x0000000000000000000000000000000000000001", "creator", 5, { x: 1 })).not.toBe(base);
    expect(policyAuthMessage("write", "0x0000000000000000000000000000000000000001", "merchant", 5, { x: 1 })).not.toBe(base);
    expect(policyAuthMessage("write", "0x0000000000000000000000000000000000000002", "creator", 5, { x: 1 })).not.toBe(base);
    expect(policyAuthMessage("write", "0x0000000000000000000000000000000000000001", "creator", 5, { x: 2 })).not.toBe(base);
  });
});

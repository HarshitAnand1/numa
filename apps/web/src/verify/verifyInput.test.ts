import { describe, expect, it } from "vitest";
import { parseVerifyInput, statusText, usdt2 } from "./verifyInput";

describe("verify input", () => {
  it("accepts 0x + 64 hex, lowercases it, trims", () => {
    const h = "0x" + "AB".repeat(32);
    expect(parseVerifyInput(`  ${h} `)).toEqual({ kind: "hash", value: h.toLowerCase() });
  });
  it("rejects blanks, short ids, wrong lengths and non-hex with a reason", () => {
    for (const bad of ["", "   ", "NMA-8821", "0x1234", "0x" + "g".repeat(64), "0x" + "a".repeat(65)]) {
      const r = parseVerifyInput(bad);
      expect(r.kind).toBe("bad");
    }
  });
  it("explains the demo label, not just rejects it", () => {
    expect((parseVerifyInput("NMA-8821") as { reason: string }).reason).toMatch(/demo labels/);
  });
  it("formats decimal USDT strings by truncating", () => {
    expect(usdt2("25.000000")).toBe("25.00");
    expect(usdt2("0.999999")).toBe("0.99");
    expect(usdt2("7")).toBe("7.00");
    expect(usdt2("x")).toBe("—");
  });
  it("describes every status the API can send and tolerates new ones", () => {
    for (const s of ["held", "released", "partially_refunded", "refunded"]) expect(statusText(s)).not.toMatch(/^Status:/);
    expect(statusText("weird")).toBe("Status: weird");
  });
});

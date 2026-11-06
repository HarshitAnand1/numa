import { describe, expect, it, vi } from "vitest";
import { reconcileSent } from "../src/services/reconciler.js";
import { MemoryRelayStore } from "../src/services/store.js";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const tx = (n: number) => `0x${(n + 500).toString(16).padStart(64, "0")}` as const;
const buyer = "0xAbC0000000000000000000000000000000000001";

async function sentStore(clock: { t: number }, n = 1) {
  const store = new MemoryRelayStore(() => clock.t);
  for (let i = 1; i <= n; i++) { await store.claimOrder(id(i), buyer); await store.markSent(id(i), tx(i)); }
  return store;
}

describe("reconcileSent", () => {
  it("books a successful receipt: settled + gas spend + address count (what the timed-out request never recorded)", async () => {
    const clock = { t: Date.UTC(2026, 10, 7, 12) };
    const store = await sentStore(clock);
    clock.t += 60_000;
    const pub = { getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", gasUsed: 100n, effectiveGasPrice: 7n }) } as never;
    expect(await reconcileSent(store, pub, { now: () => clock.t })).toMatchObject({ settled: 1, reverted: 0, pending: 0 });
    expect((await store.getClaim(id(1)))?.status).toBe("settled");
    expect(await store.spentToday("2026-11-07")).toBe(700n);
    expect(await store.countForAddress("2026-11-07", buyer)).toBe(1);
  });
  it("a reverted receipt frees the order for a new request", async () => {
    const clock = { t: 1_000_000 };
    const store = await sentStore(clock);
    clock.t += 60_000;
    const pub = { getTransactionReceipt: vi.fn().mockResolvedValue({ status: "reverted" }) } as never;
    expect(await reconcileSent(store, pub, { now: () => clock.t })).toMatchObject({ reverted: 1 });
    expect(await store.claimOrder(id(1), buyer)).toBe(true);
  });
  it("no receipt yet: pending, then stuck after the threshold; never resolved by guessing", async () => {
    const clock = { t: 1_000_000 };
    const store = await sentStore(clock);
    const pub = { getTransactionReceipt: vi.fn().mockRejectedValue(new Error("not found")) } as never;
    clock.t += 30_000;
    expect(await reconcileSent(store, pub, { now: () => clock.t })).toMatchObject({ pending: 1, stuck: 0 });
    clock.t += 700_000;
    expect(await reconcileSent(store, pub, { now: () => clock.t })).toMatchObject({ pending: 0, stuck: 1 });
    expect((await store.getClaim(id(1)))?.status).toBe("sent");
    expect(await store.claimOrder(id(1), buyer)).toBe(false);
  });
  it("ignores claims younger than the minimum age", async () => {
    const clock = { t: 1_000_000 };
    const store = await sentStore(clock);
    const pub = { getTransactionReceipt: vi.fn() } as never;
    expect(await reconcileSent(store, pub, { now: () => clock.t })).toEqual({ settled: 0, reverted: 0, pending: 0, stuck: 0 });
    expect((pub as { getTransactionReceipt: { mock: { calls: unknown[] } } }).getTransactionReceipt.mock.calls).toHaveLength(0);
  });
});

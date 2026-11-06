import { describe, expect, it, vi } from "vitest";
import { createSafeWriter } from "../src/safeWriter.js";

const addr = "0x2222222222222222222222222222222222222222" as const;
const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;

/** JSON-RPC level fake so the real viem actions (getChainId, getTransactionCount, ...) run. */
function fakeReader(o: { chainId?: number; latest?: number; pending?: number; gasPrice?: bigint; balance?: bigint } = {}) {
  const calls: string[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method);
    switch (method) {
      case "eth_chainId": return hex(o.chainId ?? 7794095);
      case "eth_getTransactionCount": return hex((params?.[1] === "pending" ? (o.pending ?? o.latest) : o.latest) ?? 5);
      case "eth_gasPrice": return hex(o.gasPrice ?? 1_000_000_000n);
      case "eth_getBalance": return hex(o.balance ?? 10n ** 18n);
      default: throw new Error(`unexpected ${method}`);
    }
  });
  return { reader: { request } as never, calls, request };
}
const wallet = () => {
  const order: string[] = [];
  const mk = (name: string) => vi.fn(async (...a: unknown[]) => { order.push(`${name}:start`); await new Promise((r) => setTimeout(r, 5)); order.push(`${name}:end`); return { name, args: a }; });
  return { w: { createEntity: mk("create"), patchEntity: mk("patch"), extendEntity: mk("extend"), deleteEntity: mk("delete") } as never, order };
};

describe("createSafeWriter", () => {
  it("injects explicit nonce, gas and gasPrice into every write kind", async () => {
    const { reader } = fakeReader({ latest: 7, gasPrice: 2_000_000_000n });
    const { w } = wallet();
    const sw = createSafeWriter(w, reader, addr);
    const expected = { nonce: 7, gas: 1_000_000n, gasPrice: 2_000_000_000n };
    const r1 = await (sw.createEntity as never as (...a: unknown[]) => Promise<{ args: unknown[] }>)("S", "v", "o");
    expect(r1.args).toEqual(["S", "v", "o", expected]);
    const r2 = await (sw.deleteEntity as never as (...a: unknown[]) => Promise<{ args: unknown[] }>)({ entityKey: "0xk" });
    expect(r2.args).toEqual([{ entityKey: "0xk" }, expected]);
  });
  it("ignores a caller-supplied txParams argument", async () => {
    const { reader } = fakeReader();
    const { w } = wallet();
    const r = await (createSafeWriter(w, reader, addr).createEntity as never as (...a: unknown[]) => Promise<{ args: unknown[] }>)("S", "v", "o", { gas: 1n });
    expect((r.args[3] as { gas: bigint }).gas).toBe(1_000_000n);
  });
  it("serializes concurrent writes (no overlap, so no nonce collisions)", async () => {
    const { reader } = fakeReader();
    const { w, order } = wallet();
    const sw = createSafeWriter(w, reader, addr);
    const c = sw.createEntity as never as (...a: unknown[]) => Promise<unknown>;
    await Promise.all([c("a", 1, 1), c("b", 2, 2), c("c", 3, 3)]);
    expect(order).toEqual(["create:start", "create:end", "create:start", "create:end", "create:start", "create:end"]);
  });
  it("refuses a non-Rabdi chain, a pending nonce, an over-cap gas price and an unfunded account — without sending", async () => {
    const cases: [Parameters<typeof fakeReader>[0], RegExp][] = [
      [{ chainId: 1 }, /Wrong chain/],
      [{ latest: 5, pending: 6 }, /Pending transaction/],
      [{ gasPrice: 10n ** 12n }, /exceeds configured max/],
      [{ balance: 1n }, /Insufficient tGLM/],
    ];
    for (const [o, re] of cases) {
      const { reader } = fakeReader(o);
      const { w } = wallet();
      const sw = createSafeWriter(w, reader, addr);
      await expect((sw.createEntity as never as (...a: unknown[]) => Promise<unknown>)("S", "v", "o")).rejects.toThrow(re);
      expect((w as unknown as { createEntity: { mock: { calls: unknown[] } } }).createEntity.mock.calls).toHaveLength(0);
    }
  });
  it("a failed write does not wedge the queue and is never retried", async () => {
    const { reader } = fakeReader();
    const createEntity = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: true });
    const sw = createSafeWriter({ createEntity } as never, reader, addr);
    const c = sw.createEntity as never as (...a: unknown[]) => Promise<unknown>;
    await expect(c("S", "v", "o")).rejects.toThrow("boom");
    expect(createEntity).toHaveBeenCalledTimes(1);
    await expect(c("S", "v", "o")).resolves.toEqual({ ok: true });
  });
});

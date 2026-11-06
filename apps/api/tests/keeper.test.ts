import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ReleaseKeeper } from "../src/services/keeper.js";
import { MemoryReleaseQueue } from "../src/services/releaseQueue.js";
import { MemoryRelayStore } from "../src/services/store.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const acct = privateKeyToAccount(generatePrivateKey());
const oid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const WINDOW = 60;
const settlement = (o: Partial<{ exists: boolean; released: boolean; heldCommission: bigint; paidAt: bigint }> = {}) => ({ exists: true, released: false, heldCommission: 5_000_000n, paidAt: 1_000n, ...o });

function setup(o: { chainNow?: number; s?: ReturnType<typeof settlement>; gasPrice?: bigint; balance?: bigint; sim?: "ok" | "fail"; receipt?: "success" | "reverted" | "timeout"; existingReceipt?: "success" | "reverted" | "none" } = {}) {
  const pub = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => (functionName === "refundWindow" ? BigInt(WINDOW) : o.s ?? settlement())),
    getBlock: vi.fn(async () => ({ timestamp: BigInt(o.chainNow ?? 2_000) })),
    getGasPrice: vi.fn(async () => o.gasPrice ?? 10n),
    simulateContract: vi.fn(async () => { if (o.sim === "fail") throw new Error("revert: NumaRouter: refund window open\nmore"); return { request: { r: 1 } }; }),
    estimateContractGas: vi.fn(async () => 100n),
    getBalance: vi.fn(async () => o.balance ?? 1_000_000n),
    waitForTransactionReceipt: vi.fn(async () => { if (o.receipt === "timeout") throw new Error("timeout"); return { status: o.receipt ?? "success", gasUsed: 90n, effectiveGasPrice: 10n }; }),
    getTransactionReceipt: vi.fn(async () => { if (!o.existingReceipt || o.existingReceipt === "none") throw new Error("nf"); return { status: o.existingReceipt }; }),
  };
  const wallet = { writeContract: vi.fn().mockResolvedValue(`0x${"cd".repeat(32)}`) };
  const queue = new MemoryReleaseQueue();
  const store = new MemoryRelayStore();
  const keeper = new ReleaseKeeper({ router, maxGasPriceWei: 100n, dailyCapWei: 10_000n, maxAttempts: 3 }, pub as never, wallet as never, acct, queue, store, () => 5_000);
  return { keeper, pub, wallet, queue, store };
}

describe("ReleaseKeeper", () => {
  it("releases an order past its refund window and books the gas", async () => {
    const { keeper, queue, wallet, store } = setup();
    await queue.add(oid(1), 1_000);
    expect(await keeper.tick()).toMatchObject({ released: 1, failed: 0 });
    expect(wallet.writeContract).toHaveBeenCalledOnce();
    expect(queue.all()[0]!.done).toBe(true);
    expect(await store.spentToday("1970-01-01")).toBe(900n);
  });
  it("uses CHAIN time: an order still inside the window per the latest block is not touched", async () => {
    const { keeper, queue, wallet, pub } = setup({ chainNow: 1_030 }); // paidAt 1000 + 60 > 1030
    await queue.add(oid(1), 1_000);
    expect(await keeper.tick()).toMatchObject({ released: 0 });
    expect(wallet.writeContract).not.toHaveBeenCalled();
    expect(pub.readContract.mock.calls.some(([a]) => (a as { functionName: string }).functionName === "getSettlement")).toBe(false);
  });
  it("double-checks the window on-chain even if the queue says it is due", async () => {
    const { keeper, queue, wallet } = setup({ s: settlement({ paidAt: 1_990n }) }); // queue paidAt stale/early, chain says window still open
    await queue.add(oid(1), 1_000);
    expect(await keeper.tick()).toMatchObject({ skipped: 1, released: 0 });
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("marks done without spending gas when already released, unknown, or nothing is held (e.g. fully refunded)", async () => {
    for (const s of [settlement({ released: true }), settlement({ exists: false }), settlement({ heldCommission: 0n })]) {
      const { keeper, queue, wallet } = setup({ s });
      await queue.add(oid(1), 1_000);
      expect(await keeper.tick()).toMatchObject({ done: 1, released: 0 });
      expect(wallet.writeContract).not.toHaveBeenCalled();
      expect(queue.all()[0]!.done).toBe(true);
    }
  });
  it("respects gas ceiling, daily cap and relayer balance without consuming attempts", async () => {
    for (const o of [{ gasPrice: 101n }, { balance: 5n }]) {
      const { keeper, queue, wallet } = setup(o);
      await queue.add(oid(1), 1_000);
      expect(await keeper.tick()).toMatchObject({ skipped: 1 });
      expect(wallet.writeContract).not.toHaveBeenCalled();
      expect(queue.all()[0]!.attempts).toBe(0);
    }
    const { keeper, queue, store } = setup();
    await store.addSpend("1970-01-01", 9_500n);
    await queue.add(oid(1), 1_000);
    expect(await keeper.tick()).toMatchObject({ skipped: 1 });
  });
  it("a failing simulation counts an attempt and stops retrying after maxAttempts", async () => {
    const { keeper, queue, wallet } = setup({ sim: "fail" });
    await queue.add(oid(1), 1_000);
    for (let i = 0; i < 3; i++) expect(await keeper.tick()).toMatchObject({ failed: 1 });
    expect(await keeper.tick()).toMatchObject({ failed: 0, skipped: 1 });
    expect(queue.all()[0]!.attempts).toBe(3);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("a receipt timeout stores the tx hash and the next tick resolves it WITHOUT sending a second release", async () => {
    const { keeper, queue, wallet, pub } = setup({ receipt: "timeout", existingReceipt: "success" });
    await queue.add(oid(1), 1_000);
    await keeper.tick();
    expect(queue.all()[0]!.txHash).not.toBeNull();
    expect(await keeper.tick()).toMatchObject({ done: 1, released: 0 });
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
    expect(queue.all()[0]!.done).toBe(true);
    expect(pub.simulateContract).toHaveBeenCalledTimes(1);
  });
  it("while the earlier tx has no receipt yet it sends nothing", async () => {
    const { keeper, queue, wallet } = setup({ receipt: "timeout", existingReceipt: "none" });
    await queue.add(oid(1), 1_000);
    await keeper.tick();
    expect(await keeper.tick()).toMatchObject({ skipped: 1 });
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
  });
  it("a reverted release clears the hash and counts an attempt", async () => {
    const { keeper, queue } = setup({ receipt: "reverted" });
    await queue.add(oid(1), 1_000);
    expect(await keeper.tick()).toMatchObject({ failed: 1 });
    expect(queue.all()[0]).toMatchObject({ txHash: null, attempts: 1, done: false });
  });
  it("queue add is idempotent (indexer replays)", async () => {
    const q = new MemoryReleaseQueue();
    await q.add(oid(1), 1_000); await q.markDone(oid(1)); await q.add(oid(1), 9_999);
    expect(q.all()).toHaveLength(1);
    expect(q.all()[0]).toMatchObject({ paidAt: 1_000, done: true });
  });
});

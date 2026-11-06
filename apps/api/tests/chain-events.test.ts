import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Hex } from "viem";
import { numaRouterAbi } from "@numa/shared";
import { verifyConversion, type ConversionClaim } from "../src/services/verify.js";
import { computeReputation } from "../src/services/reputation.js";
import { Indexer, MemoryCursor, type ConversionSink } from "../src/services/indexer.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const merchant = "0x3333333333333333333333333333333333333333" as const;
const buyer = "0x4444444444444444444444444444444444444444" as const;
const orderId = `0x${"0a".repeat(32)}` as Hex;
const txHash = `0x${"ee".repeat(32)}` as Hex;

function settledLog(over: { gross?: bigint; creator?: `0x${string}`; address?: `0x${string}`; oid?: Hex; block?: bigint; idx?: number } = {}) {
  const abiItem = getAbiItem({ abi: numaRouterAbi, name: "OrderSettled" });
  const topics = encodeEventTopics({ abi: [abiItem], eventName: "OrderSettled", args: { orderId: over.oid ?? orderId, campaignId: 7n, merchant } });
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [over.creator ?? creator, buyer, over.gross ?? 100_000_000n, 89_500_000n, 10_000_000n, 500_000n],
  );
  return { address: over.address ?? router, topics, data, blockNumber: over.block ?? 10n, transactionHash: txHash, logIndex: over.idx ?? 0, blockHash: `0x${"bb".repeat(32)}`, transactionIndex: 0, removed: false };
}
const claim: ConversionClaim = { creator, merchant, campaignId: 7n, gross: 100_000_000n, commission: 10_000_000n, txHash, orderId };
const pubWith = (logs: unknown[], status = "success") => ({ getTransactionReceipt: vi.fn().mockResolvedValue({ status, logs, blockNumber: 10n }) }) as never;

describe("verifyConversion", () => {
  it("accepts a record matching the OrderSettled event and returns the buyer", async () => {
    const r = await verifyConversion(pubWith([settledLog()]), router, claim);
    expect(r).toMatchObject({ ok: true, value: { buyer } });
  });
  it("rejects wrong gross, creator, foreign emitter, failed tx and missing tx", async () => {
    expect(await verifyConversion(pubWith([settledLog({ gross: 1n })]), router, claim)).toMatchObject({ ok: false, reason: "gross mismatch" });
    expect(await verifyConversion(pubWith([settledLog({ creator: buyer })]), router, claim)).toMatchObject({ ok: false, reason: "creator mismatch" });
    expect(await verifyConversion(pubWith([settledLog({ address: buyer })]), router, claim)).toMatchObject({ ok: false });
    expect(await verifyConversion(pubWith([settledLog()], "reverted"), router, claim)).toMatchObject({ ok: false, reason: "tx failed" });
    const missing = { getTransactionReceipt: vi.fn().mockRejectedValue(new Error("nf")) } as never;
    expect(await verifyConversion(missing, router, claim)).toMatchObject({ ok: false, reason: "tx not found" });
  });
});

describe("computeReputation", () => {
  it("returns the no-history label and null score", () => {
    expect(computeReputation([])).toMatchObject({ score: null, label: "No verified sales history yet." });
  });
  it("rewards more gross and more distinct payers; penalizes a single repeat payer", () => {
    const mk = (b: string, g: bigint) => ({ gross: g, commission: g / 10n, buyer: b as `0x${string}` });
    const many = computeReputation(Array.from({ length: 5 }, (_, i) => mk(`0x${String(i).repeat(40)}`, 100_000_000n)));
    const single = computeReputation(Array.from({ length: 5 }, () => mk(`0x${"1".repeat(40)}`, 100_000_000n)));
    const tiny = computeReputation([mk(`0x${"1".repeat(40)}`, 1_000_000n)]);
    expect(many.score!).toBeGreaterThan(single.score!);
    expect(single.score!).toBeGreaterThan(tiny.score!);
    expect(many.distinctPayers).toBe(5);
    expect(many.commissionEarned).toBe(50_000_000n);
  });
  it("ignores fully refunded orders", () => {
    const r = computeReputation([{ gross: 5n, commission: 1n, buyer, refunded: true }]);
    expect(r.score).toBeNull();
  });
});

describe("Indexer", () => {
  function fakeSink() {
    const rows = new Map<string, { gross: bigint; status: string }>();
    const sink: ConversionSink = {
      get: async (id) => rows.get(id),
      publish: async (c) => { rows.set(c.orderId, { gross: c.gross, status: c.status }); },
      setStatus: async (id, s) => { rows.get(id)!.status = s; },
    };
    return { sink, rows };
  }
  const pub = (logs: unknown[]) => ({
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    getLogs: vi.fn().mockResolvedValue(logs),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
  }) as never;

  it("publishes a held conversion once, advancing the cursor (idempotent)", async () => {
    const { sink, rows } = fakeSink();
    const cursor = new MemoryCursor(0n);
    const ix = new Indexer(pub([settledLog()]), router, sink, cursor, 2000n, 0n);
    expect(await ix.tick()).toBe(1);
    expect(rows.get(orderId)).toEqual({ gross: 100_000_000n, status: "held" });
    expect(await cursor.get()).toBe(100n);
    // replay of the same range: no duplicate
    await new Indexer(pub([settledLog()]), router, sink, new MemoryCursor(0n), 2000n, 0n).tick();
    expect(rows.size).toBe(1);
  });
  it("applies release and partial refund statuses after settlement", async () => {
    const { sink, rows } = fakeSink();
    const refund = (amt: bigint, idx: number) => {
      const item = getAbiItem({ abi: numaRouterAbi, name: "OrderRefunded" });
      return { address: router, topics: encodeEventTopics({ abi: [item], eventName: "OrderRefunded", args: { orderId } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [amt, 5_000_000n, amt - 5_000_000n]), blockNumber: 11n, transactionHash: txHash, logIndex: idx, blockHash: `0x${"bb".repeat(32)}`, transactionIndex: 0, removed: false };
    };
    const ix = new Indexer(pub([refund(50_000_000n, 1), settledLog()]), router, sink, new MemoryCursor(0n), 2000n, 0n);
    await ix.tick(); // events given out of order; indexer sorts them
    expect(rows.get(orderId)!.status).toBe("partially_refunded");
  });
  it("does nothing when no new blocks", async () => {
    const { sink } = fakeSink();
    const ix = new Indexer(pub([]), router, sink, new MemoryCursor(100n), 2000n, 0n);
    expect(await ix.tick()).toBe(0);
  });
});

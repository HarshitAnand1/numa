import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Address, type Hex } from "viem";
import { numaRouterAbi } from "@numa/shared";
import { CSV_HEADER, LedgerRangeError, ledgerToCsv, loadLedger } from "../src/services/ledger.js";
import { registerLedgerRoutes } from "../src/routes/ledger.js";
import { MemoryRelayStore } from "../src/services/store.js";

const router = "0x1111111111111111111111111111111111111111" as Address;
const creator = "0x2222222222222222222222222222222222222222" as Address;
const merchant = "0x3333333333333333333333333333333333333333" as Address;
const other = "0x5555555555555555555555555555555555555555" as Address;
const buyer = "0x4444444444444444444444444444444444444444" as Address;
const oid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const base = { address: router, transactionHash: `0x${"ee".repeat(32)}`, blockHash: `0x${"bb".repeat(32)}`, transactionIndex: 0, removed: false };
const settled = (orderId: Hex, block: bigint, m: Address = merchant, gross = 100_000_000n) => ({
  ...base, blockNumber: block, logIndex: 0,
  topics: encodeEventTopics({ abi: [getAbiItem({ abi: numaRouterAbi, name: "OrderSettled" })], eventName: "OrderSettled", args: { orderId, campaignId: 7n, merchant: m } }),
  data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [creator, buyer, gross, gross - gross / 10n - gross / 200n, gross / 10n, gross / 200n]),
});
const refunded = (orderId: Hex, block: bigint, amount: bigint, claw: bigint, pulled: bigint) => ({
  ...base, blockNumber: block, logIndex: 1,
  topics: encodeEventTopics({ abi: [getAbiItem({ abi: numaRouterAbi, name: "OrderRefunded" })], eventName: "OrderRefunded", args: { orderId } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [amount, claw, pulled]),
});
const released = (orderId: Hex, block: bigint, amount: bigint) => ({
  ...base, blockNumber: block, logIndex: 2,
  topics: encodeEventTopics({ abi: [getAbiItem({ abi: numaRouterAbi, name: "CommissionReleased" })], eventName: "CommissionReleased", args: { orderId, creator } }),
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
});
const chain = (logs: unknown[], head = 100n) => ({
  getBlockNumber: async () => head,
  getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => (logs as { blockNumber: bigint }[]).filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)),
  getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_800_000_000n + blockNumber * 10n }),
}) as never;

describe("ledger", () => {
  it("rebuilds each order with refunds and release, ignoring other merchants' orders", async () => {
    const logs = [settled(oid(1), 10n), settled(oid(2), 20n), settled(oid(3), 30n, other), refunded(oid(2), 25n, 20_000_000n, 2_010_050n, 17_989_950n), released(oid(1), 50n, 10_000_000n)];
    const rows = await loadLedger(chain(logs), router, { merchant, fromBlock: 0n });
    expect(rows.map((r) => r.orderId)).toEqual([oid(1), oid(2)]); // other merchant's order excluded
    expect(rows[0]).toMatchObject({ status: "released", released: true, commissionReleased: 10_000_000n, refunded: 0n });
    expect(rows[1]).toMatchObject({ status: "partially_refunded", refunded: 20_000_000n, merchantPulled: 17_989_950n, released: false });
  });
  it("a full refund of gross minus the protocol fee is 'refunded'", async () => {
    const fee = 500_000n; // 0.5% of 100
    const rows = await loadLedger(chain([settled(oid(1), 10n), refunded(oid(1), 11n, 100_000_000n - fee, 10_000_000n, 89_500_000n)]), router, { merchant, fromBlock: 0n });
    expect(rows[0]!.status).toBe("refunded");
  });
  it("walks long ranges in chunks and refuses absurd ranges", async () => {
    const c = chain([settled(oid(1), 10n), settled(oid(2), 5_000n)], 6_000n);
    const rows = await loadLedger(c, router, { merchant, fromBlock: 0n, maxRange: 2_000n });
    expect(rows).toHaveLength(2);
    await expect(loadLedger(chain([], 10_000_000n), router, { merchant, fromBlock: 0n })).rejects.toBeInstanceOf(LedgerRangeError);
  });
  it("CSV has a stable header, exact 6-decimal amounts and net-after-refunds", async () => {
    const rows = await loadLedger(chain([settled(oid(2), 20n), refunded(oid(2), 25n, 20_000_000n, 2_010_050n, 17_989_950n)]), router, { merchant, fromBlock: 0n });
    const csv = ledgerToCsv(rows).trim().split("\n");
    expect(csv[0]).toBe(CSV_HEADER.join(","));
    const cells = csv[1]!.split(",");
    expect(cells).toHaveLength(CSV_HEADER.length);
    expect(cells[CSV_HEADER.indexOf("gross_usdt")]).toBe("100");
    expect(cells[CSV_HEADER.indexOf("protocol_fee_usdt")]).toBe("0.5");
    expect(cells[CSV_HEADER.indexOf("merchant_net_after_refunds_usdt")]).toBe("71.51005"); // 89.5 net minus the 17.98995 the merchant funded
    expect(cells[CSV_HEADER.indexOf("status")]).toBe("partially_refunded");
  });
});

describe("ledger routes", () => {
  const app = (logs: unknown[], settlement?: object) => {
    const a = Fastify();
    const pub = { ...(chain(logs) as object), readContract: async () => settlement ?? { exists: false } } as never;
    const store = new MemoryRelayStore();
    registerLedgerRoutes(a, { pub, router, relayStore: store, startBlock: 0n });
    return { a, store };
  };
  it("serves the merchant ledger as JSON and as a CSV download", async () => {
    const { a } = app([settled(oid(1), 10n)]);
    const j = (await a.inject(`/merchants/${merchant}/orders`)).json();
    expect(j).toMatchObject({ count: 1, orders: [{ grossUsdt: "100", status: "held", commissionReleased: false }] });
    const csv = await a.inject(`/merchants/${merchant}/orders?format=csv`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.body.split("\n")[0]).toBe(CSV_HEADER.join(","));
    expect((await a.inject("/merchants/nope/orders")).statusCode).toBe(400);
  });
  it("returns a customer receipt from the chain's settlement record, 404 for unknown orders, 400 for malformed ids", async () => {
    const settlement = { exists: true, merchant, creator, buyer, gross: 100_000_000n, commission: 10_000_000n, fee: 500_000n, heldCommission: 10_000_000n, refundedGross: 0n, paidAt: 1_800_000_000n, released: false };
    const { a, store } = app([], settlement);
    await store.claimOrder(oid(1), buyer); await store.markSent(oid(1), `0x${"ab".repeat(32)}`);
    const r = (await a.inject(`/receipts/${oid(1)}`)).json();
    expect(r).toMatchObject({ grossUsdt: "100.000000", merchantNetUsdt: "89.500000", creatorCommissionUsdt: "10.000000", status: "held", txHash: `0x${"ab".repeat(32)}` });
    expect(r.explorerUrl).toContain("/tx/0x");
    expect((await app([]).a.inject(`/receipts/${oid(9)}`)).statusCode).toBe(404);
    expect((await a.inject("/receipts/0x12")).statusCode).toBe(400);
  });
});

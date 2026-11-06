import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { orderTypedData, type RelayRequest } from "@numa/shared";
import { Relayer, RelayError, type RelayerConfig } from "../src/services/relayer.js";
import { MemoryRelayStore } from "../src/services/store.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const buyer = "0x3333333333333333333333333333333333333333" as const;
const NOW = 1_000;
const relayerAcct = privateKeyToAccount(generatePrivateKey());
const merchant = privateKeyToAccount(generatePrivateKey());
const cfg: RelayerConfig = { router, chainId: 1874, maxGasPriceWei: 100n, dailyCapWei: 10_000n, perAddressDailyLimit: 2 };

async function makeReq(over: Partial<RelayRequest["order"]> = {}): Promise<RelayRequest> {
  const order = { campaignId: 1n, orderId: `0x${"01".repeat(32)}` as const, creator, amount: 5_000_000n, deadline: 2_000n, ...over };
  const merchantSig = await merchant.signTypedData(orderTypedData(order, 1874, router));
  return { order, merchantSig, buyer, auth: { validAfter: 0n, validBefore: 5_000n, v: 27, r: `0x${"aa".repeat(32)}`, s: `0x${"bb".repeat(32)}` } };
}

function setup(pubOver: Record<string, unknown> = {}) {
  const pub = {
    getGasPrice: vi.fn().mockResolvedValue(10n),
    simulateContract: vi.fn().mockResolvedValue({ request: { foo: 1 } }),
    estimateContractGas: vi.fn().mockResolvedValue(100n),
    getBalance: vi.fn().mockResolvedValue(1_000_000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: 9n, gasUsed: 90n, effectiveGasPrice: 10n }),
    ...pubOver,
  };
  const wallet = { writeContract: vi.fn().mockResolvedValue(`0x${"cd".repeat(32)}`) };
  const store = new MemoryRelayStore();
  const relayer = new Relayer(cfg, pub as never, wallet as never, relayerAcct, store, () => NOW);
  return { pub, wallet, store, relayer };
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof RelayError ? e.code : String(e)));

describe("Relayer", () => {
  let req: RelayRequest;
  beforeEach(async () => { req = await makeReq(); });

  it("submits a valid order and records spend", async () => {
    const { relayer, wallet, store } = setup();
    const r = await relayer.submit(req);
    expect(r.blockNumber).toBe(9n);
    expect(r.gasCostWei).toBe(900n);
    expect(wallet.writeContract).toHaveBeenCalledOnce();
    expect(store.spentToday("1970-01-01")).toBe(900n);
  });
  it("rejects expired order", async () => {
    const { relayer, wallet } = setup();
    expect(await code(relayer.submit(await makeReq({ deadline: 999n })))).toBe("ORDER_EXPIRED");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("rejects expired authorization window", async () => {
    const { relayer } = setup();
    req.auth.validBefore = 500n;
    expect(await code(relayer.submit(req))).toBe("BAD_AUTH_WINDOW");
  });
  it("rejects buyer == creator", async () => {
    const { relayer } = setup();
    expect(await code(relayer.submit({ ...req, buyer: creator }))).toBe("BAD_SELF_PURCHASE");
  });
  it("rejects malformed merchant signature", async () => {
    const { relayer } = setup();
    expect(await code(relayer.submit({ ...req, merchantSig: "0x1234" }))).toBe("BAD_MERCHANT_SIG");
  });
  it("rejects duplicate in-flight and settled orders", async () => {
    const { relayer } = setup();
    await relayer.submit(req);
    expect(await code(relayer.submit(req))).toBe("DUPLICATE");
  });
  it("rejects gas price above ceiling and releases claim", async () => {
    const { relayer, store } = setup({ getGasPrice: vi.fn().mockResolvedValue(101n) });
    expect(await code(relayer.submit(req))).toBe("GAS_PRICE_TOO_HIGH");
    expect(store.claimOrder(req.order.orderId)).toBe(true);
  });
  it("rejects when simulation fails", async () => {
    const { relayer, wallet } = setup({ simulateContract: vi.fn().mockRejectedValue(new Error("revert: NotApproved\nmore")) });
    expect(await code(relayer.submit(req))).toBe("SIMULATION_FAILED");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("enforces daily gas cap", async () => {
    const { relayer, store } = setup();
    store.addSpend("1970-01-01", 9_500n);
    expect(await code(relayer.submit(req))).toBe("DAILY_CAP_EXCEEDED");
  });
  it("enforces per-address limit", async () => {
    const { relayer } = setup();
    await relayer.submit(req);
    await relayer.submit(await makeReq({ orderId: `0x${"02".repeat(32)}` }));
    expect(await code(relayer.submit(await makeReq({ orderId: `0x${"03".repeat(32)}` })))).toBe("ADDRESS_LIMIT_EXCEEDED");
  });
  it("rejects when relayer balance is insufficient", async () => {
    const { relayer } = setup({ getBalance: vi.fn().mockResolvedValue(10n) });
    expect(await code(relayer.submit(req))).toBe("INSUFFICIENT_RELAYER_BALANCE");
  });
  it("reports reverted tx and keeps the claim (no auto-retry)", async () => {
    const { relayer, store } = setup({ waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "reverted" }) });
    expect(await code(relayer.submit(req))).toBe("TX_REVERTED");
    expect(store.claimOrder(req.order.orderId)).toBe(false);
  });
  it("reports receipt timeout", async () => {
    const { relayer } = setup({ waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("timeout")) });
    expect(await code(relayer.submit(req))).toBe("TX_TIMEOUT");
  });
});

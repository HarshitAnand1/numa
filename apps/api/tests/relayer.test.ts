import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSignature } from "viem";
import { computeOrderCommitment, orderTypedData, receiveAuthTypedData, type RelayRequest, type Order } from "@numa/shared";
import { Relayer, RelayError, type RelayerConfig } from "../src/services/relayer.js";
import { MemoryRelayStore } from "../src/services/store.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const registry = "0x7777777777777777777777777777777777777777" as const;
const merchant = "0x6666666666666666666666666666666666666666" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const buyerAcct = privateKeyToAccount(generatePrivateKey());
const buyer = buyerAcct.address;
const NOW = 1_000;
const relayerAcct = privateKeyToAccount(generatePrivateKey());
const merchantSigner = privateKeyToAccount(generatePrivateKey());
const COMMISSION_BPS = 1000n;
const FEE_BPS = 50n;
const cfg: RelayerConfig = { router, registry, chainId: 1874, maxGasPriceWei: 100n, dailyCapWei: 10_000n, perAddressDailyLimit: 2 };

async function makeReq(over: Partial<Order> = {}): Promise<RelayRequest> {
  const order: Order = { campaignId: 1n, merchant, creator, buyer, gross: 5_000_000n, orderId: `0x${"01".repeat(32)}` as const, deadline: 2_000n, ...over };
  const merchantSig = await merchantSigner.signTypedData(orderTypedData(order, 1874, router));
  const nonce = computeOrderCommitment({ ...order, commissionBps: COMMISSION_BPS, feeBps: FEE_BPS }, 1874, router);
  const sig = await buyerAcct.signTypedData(receiveAuthTypedData({ from: buyer, router, value: order.gross, validAfter: 0n, validBefore: 5_000n, nonce }, 1874));
  const { r, s, v } = parseSignature(sig);
  return { order, merchantSig, auth: { validAfter: 0n, validBefore: 5_000n, v: Number(v), r, s } };
}

function setup(pubOver: Record<string, unknown> = {}) {
  const pub = {
    readContract: vi.fn(({ functionName }: { functionName: string }) =>
      functionName === "feeBps" ? Promise.resolve(FEE_BPS) : Promise.resolve({ merchant, payoutSigner: merchantSigner.address, commissionBps: COMMISSION_BPS, endsAt: 9_999_999n, paused: false, exists: true }),
    ),
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
    expect(await store.spentToday("1970-01-01")).toBe(900n);
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
    expect(await code(relayer.submit(await makeReq({ buyer: creator })))).toBe("BAD_SELF_PURCHASE");
  });
  it("rejects buyer == merchant", async () => {
    const { relayer } = setup();
    expect(await code(relayer.submit(await makeReq({ buyer: merchant })))).toBe("BAD_SELF_PURCHASE");
  });
  it("rejects malformed merchant signature", async () => {
    const { relayer } = setup();
    expect(await code(relayer.submit({ ...req, merchantSig: "0x1234" }))).toBe("BAD_MERCHANT_SIG");
  });
  it("rejects an authorization signed for a different amount, recipient window or signer", async () => {
    const { relayer, pub } = setup();
    // order gross differs from what the buyer authorized
    const other = await makeReq();
    expect(await code(relayer.submit({ ...other, order: { ...other.order, gross: other.order.gross + 1n } }))).toBe("BAD_BUYER_AUTH");
    // different validBefore than signed
    const w = await makeReq();
    expect(await code(relayer.submit({ ...w, auth: { ...w.auth, validBefore: 4_000n } }))).toBe("BAD_BUYER_AUTH");
    // signature from someone else
    const stranger = privateKeyToAccount(generatePrivateKey());
    const o = await makeReq();
    const nonce = computeOrderCommitment({ ...o.order, commissionBps: COMMISSION_BPS, feeBps: FEE_BPS }, 1874, router);
    const bad = parseSignature(await stranger.signTypedData(receiveAuthTypedData({ from: buyer, router, value: o.order.gross, validAfter: 0n, validBefore: 5_000n, nonce }, 1874)));
    expect(await code(relayer.submit({ ...o, auth: { ...o.auth, v: Number(bad.v), r: bad.r, s: bad.s } }))).toBe("BAD_BUYER_AUTH");
    // rejected locally: no gas/simulation RPC calls were made (registry/feeBps reads happen before this point)
    expect(pub.getGasPrice).not.toHaveBeenCalled();
    expect(pub.simulateContract).not.toHaveBeenCalled();
  });
  it("rejects when the authNonce doesn't match the recomputed commitment (e.g. wrong on-chain commissionBps)", async () => {
    const { relayer } = setup({
      readContract: vi.fn(({ functionName }: { functionName: string }) =>
        functionName === "feeBps" ? Promise.resolve(FEE_BPS) : Promise.resolve({ merchant, payoutSigner: merchantSigner.address, commissionBps: 9999n, endsAt: 9_999_999n, paused: false, exists: true }),
      ),
    });
    // req's buyer authorization was signed against COMMISSION_BPS=1000n, but this registry mock
    // reports a different commissionBps - the recomputed commitment won't match the buyer's nonce.
    expect(await code(relayer.submit(req))).toBe("BAD_BUYER_AUTH");
  });
  it("rejects malformed auth signature values", async () => {
    const { relayer } = setup();
    expect(await code(relayer.submit({ ...req, auth: { ...req.auth, r: `0x${"00".repeat(32)}`, s: `0x${"00".repeat(32)}` } }))).toBe("BAD_BUYER_AUTH");
  });
  it("rejects duplicate in-flight and settled orders", async () => {
    const { relayer } = setup();
    await relayer.submit(req);
    expect(await code(relayer.submit(req))).toBe("DUPLICATE");
  });
  it("rejects gas price above ceiling and releases claim", async () => {
    const { relayer, store } = setup({ getGasPrice: vi.fn().mockResolvedValue(101n) });
    expect(await code(relayer.submit(req))).toBe("GAS_PRICE_TOO_HIGH");
    expect(await store.claimOrder(req.order.orderId, buyer)).toBe(true);
  });
  it("rejects when simulation fails", async () => {
    const { relayer, wallet } = setup({ simulateContract: vi.fn().mockRejectedValue(new Error("revert: NotApproved\nmore")) });
    expect(await code(relayer.submit(req))).toBe("SIMULATION_FAILED");
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("enforces daily gas cap", async () => {
    const { relayer, store } = setup();
    await store.addSpend("1970-01-01", 9_500n);
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
    expect(await store.claimOrder(req.order.orderId, buyer)).toBe(false);
  });
  it("reports receipt timeout", async () => {
    const { relayer } = setup({ waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("timeout")) });
    expect(await code(relayer.submit(req))).toBe("TX_TIMEOUT");
  });
});

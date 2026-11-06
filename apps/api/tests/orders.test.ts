import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deriveAuthNonce, orderTypedData } from "@numa/shared";
import { OrderService } from "../src/services/orders.js";
import { loadEnv } from "../src/config/env.js";

const router = "0x1111111111111111111111111111111111111111";
const creator = "0x2222222222222222222222222222222222222222";

describe("OrderService", () => {
  it("signs an order recoverable to the merchant signer", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const svc = new OrderService(acct, 1874, router, 900, () => 1_000);
    const o = await svc.createOrder({ campaignId: 7n, creator, amount: "25.00" });
    expect(o.order.amount).toBe(25_000_000n);
    expect(o.order.deadline).toBe(1_900n);
    const rec = await recoverTypedDataAddress({ ...orderTypedData(o.order, 1874, router), signature: o.merchantSig });
    expect(rec).toBe(acct.address);
  });
  it("derives a deterministic nonce bound to digest and creator", () => {
    const d = `0x${"ab".repeat(32)}` as const;
    expect(deriveAuthNonce(d, creator)).toBe(deriveAuthNonce(d, creator));
    expect(deriveAuthNonce(d, creator)).not.toBe(deriveAuthNonce(d, router));
  });
  it("rejects zero amounts", async () => {
    const svc = new OrderService(privateKeyToAccount(generatePrivateKey()), 1874, router, 900);
    await expect(svc.createOrder({ campaignId: 1n, creator, amount: "0" })).rejects.toThrow();
  });
});

describe("loadEnv", () => {
  it("rejects http RPC and bad keys", () => {
    expect(() => loadEnv({ WHITECHAIN_RPC_URL: "http://x.io" })).toThrow(/Invalid environment/);
  });
});

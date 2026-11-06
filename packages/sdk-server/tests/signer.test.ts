import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deriveAuthNonce, orderTypedData } from "@numa/shared";
import { OrderSigner } from "../src/index.js";

const router = "0x1111111111111111111111111111111111111111";
const creator = "0x2222222222222222222222222222222222222222";
const mk = () => new OrderSigner(privateKeyToAccount(generatePrivateKey()), 1874, router, 900, () => 1_000);

describe("OrderSigner", () => {
  it("signs an order recoverable to the merchant signer and returns the auth nonce", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const o = await new OrderSigner(acct, 1874, router, 900, () => 1_000).createOrder({ campaignId: 7n, creator, amount: "25.00" });
    expect(o.order.amount).toBe(25_000_000n);
    expect(o.order.deadline).toBe(1_900n);
    expect(await recoverTypedDataAddress({ ...orderTypedData(o.order, 1874, router), signature: o.merchantSig })).toBe(acct.address);
    expect(o.authNonce).toBe(deriveAuthNonce(o.digest, creator));
  });
  it("generates unique order ids and respects a supplied one", async () => {
    const s = mk();
    const a = await s.createOrder({ campaignId: 1n, creator, amount: "1" });
    const b = await s.createOrder({ campaignId: 1n, creator, amount: "1" });
    expect(a.order.orderId).not.toBe(b.order.orderId);
    const fixed = `0x${"ab".repeat(32)}` as const;
    expect((await s.createOrder({ campaignId: 1n, creator, amount: "1", orderId: fixed })).order.orderId).toBe(fixed);
  });
  it("rejects zero, negative-looking and over-precise amounts", async () => {
    const s = mk();
    for (const amount of ["0", "-5", "1.1234567", "abc", ""]) {
      await expect(s.createOrder({ campaignId: 1n, creator, amount })).rejects.toThrow();
    }
  });
});

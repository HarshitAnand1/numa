import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { computeOrderCommitment, orderTypedData } from "@numa/shared";
import { OrderSigner } from "../src/index.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const merchant = "0x6666666666666666666666666666666666666666" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const buyer = "0x3333333333333333333333333333333333333333" as const;
const COMMISSION_BPS = 1000n;
const FEE_BPS = 50n;
const mk = () => new OrderSigner(privateKeyToAccount(generatePrivateKey()), 1874, router, 900, () => 1_000);

describe("OrderSigner", () => {
  it("signs an order recoverable to the payout signer and returns the auth nonce", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const o = await new OrderSigner(acct, 1874, router, 900, () => 1_000).createOrder({
      campaignId: 7n, merchant, creator, buyer, amount: "25.00", commissionBps: COMMISSION_BPS, feeBps: FEE_BPS,
    });
    expect(o.order.gross).toBe(25_000_000n);
    expect(o.order.merchant).toBe(merchant);
    expect(o.order.buyer).toBe(buyer);
    expect(o.order.deadline).toBe(1_900n);
    expect(await recoverTypedDataAddress({ ...orderTypedData(o.order, 1874, router), signature: o.merchantSig })).toBe(acct.address);
    expect(o.payoutSigner).toBe(acct.address);
    expect(o.authNonce).toBe(
      computeOrderCommitment(
        { campaignId: 7n, merchant, creator, buyer, gross: 25_000_000n, commissionBps: COMMISSION_BPS, feeBps: FEE_BPS, orderId: o.order.orderId, deadline: o.order.deadline },
        1874, router,
      ),
    );
  });
  it("generates unique order ids and respects a supplied one", async () => {
    const s = mk();
    const base = { campaignId: 1n, merchant, creator, buyer, amount: "1", commissionBps: COMMISSION_BPS, feeBps: FEE_BPS };
    const a = await s.createOrder(base);
    const b = await s.createOrder(base);
    expect(a.order.orderId).not.toBe(b.order.orderId);
    const fixed = `0x${"ab".repeat(32)}` as const;
    expect((await s.createOrder({ ...base, orderId: fixed })).order.orderId).toBe(fixed);
  });
  it("rejects zero, negative-looking and over-precise amounts", async () => {
    const s = mk();
    for (const amount of ["0", "-5", "1.1234567", "abc", ""]) {
      await expect(s.createOrder({ campaignId: 1n, merchant, creator, buyer, amount, commissionBps: COMMISSION_BPS, feeBps: FEE_BPS })).rejects.toThrow();
    }
  });
});

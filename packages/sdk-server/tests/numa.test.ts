import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { orderTypedData } from "@numa/shared";
import { Numa, toRelayRequest } from "../src/index.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const merchant = "0x6666666666666666666666666666666666666666" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const buyer = "0x3333333333333333333333333333333333333333" as const;
const base = { campaignId: 7, merchant, router, commissionBps: 1000, feeBps: 50 } as const;

describe("Numa", () => {
  it("returns a JSON-serializable payload signed by the configured key", async () => {
    const key = generatePrivateKey();
    const numa = new Numa({ ...base, signerKey: key });
    expect(numa.signerAddress).toBe(privateKeyToAccount(key).address);
    const p = await numa.createOrder({ amount: "25.00", creator, buyer });
    expect(() => JSON.stringify(p)).not.toThrow();
    expect(p.order).toMatchObject({ campaignId: "7", merchant, creator, buyer, gross: "25000000" });
    expect(p.chainId).toBe(1874);
    const order = { campaignId: 7n, merchant, creator, buyer, orderId: p.order.orderId, gross: 25_000_000n, deadline: BigInt(p.order.deadline) };
    expect(await recoverTypedDataAddress({ ...orderTypedData(order, 1874, router), signature: p.merchantSig })).toBe(numa.signerAddress);
    expect(p.payoutSigner).toBe(numa.signerAddress);
  });
  it("the payload feeds the relayer's /relay schema directly (no field renaming)", async () => {
    const numa = new Numa({ ...base, signerKey: generatePrivateKey() });
    const p = await numa.createOrder({ amount: "25.00", creator, buyer });
    const r = "0x" + "11".repeat(32), s = "0x" + "22".repeat(32);
    const body = toRelayRequest(p, { validAfter: "0", validBefore: "9999999999", v: 27, r: r as `0x${string}`, s: s as `0x${string}` });
    expect(body.order.gross).toBe(25_000_000n);
    expect(body.merchantSig).toBe(p.merchantSig);
    expect(() => toRelayRequest({ ...p, order: { ...p.order, gross: "1.5" } }, { validAfter: "0", validBefore: "1", v: 27, r: r as `0x${string}`, s: s as `0x${string}` })).toThrow();
  });
  it("validates configuration and inputs", async () => {
    expect(() => new Numa({ ...base, signerKey: "0x12" as never })).toThrow(/signerKey/);
    expect(() => new Numa({ ...base, signerKey: generatePrivateKey(), router: "nope" as never })).toThrow(/router/);
    expect(() => new Numa({ ...base, signerKey: generatePrivateKey(), merchant: "nope" as never })).toThrow(/merchant/);
    const numa = new Numa({ ...base, signerKey: generatePrivateKey() });
    await expect(numa.createOrder({ amount: "5", creator: "bad" as never, buyer })).rejects.toThrow(/creator/);
    await expect(numa.createOrder({ amount: "5", creator, buyer: "bad" as never })).rejects.toThrow(/buyer/);
  });
});

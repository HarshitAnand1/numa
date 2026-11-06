import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { orderTypedData } from "@numa/shared";
import { Numa } from "../src/index.js";

const router = "0x1111111111111111111111111111111111111111" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;

describe("Numa", () => {
  it("returns a JSON-serializable payload signed by the configured key", async () => {
    const key = generatePrivateKey();
    const numa = new Numa({ campaignId: 7, signerKey: key, router });
    expect(numa.signerAddress).toBe(privateKeyToAccount(key).address);
    const p = await numa.createOrder({ amount: "25.00", creator });
    expect(() => JSON.stringify(p)).not.toThrow();
    expect(p.order).toMatchObject({ campaignId: "7", amount: "25000000", creator });
    expect(p.chainId).toBe(1874);
    const order = { campaignId: 7n, orderId: p.order.orderId, creator, amount: 25_000_000n, deadline: BigInt(p.order.deadline) };
    expect(await recoverTypedDataAddress({ ...orderTypedData(order, 1874, router), signature: p.merchantSig })).toBe(numa.signerAddress);
  });
  it("validates configuration and inputs", async () => {
    expect(() => new Numa({ campaignId: 1, signerKey: "0x12" as never, router })).toThrow(/signerKey/);
    expect(() => new Numa({ campaignId: 1, signerKey: generatePrivateKey(), router: "nope" as never })).toThrow(/router/);
    const numa = new Numa({ campaignId: 1, signerKey: generatePrivateKey(), router });
    await expect(numa.createOrder({ amount: "5", creator: "bad" as never })).rejects.toThrow(/creator/);
  });
});

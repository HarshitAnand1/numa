import { randomBytes } from "node:crypto";
import { parseUnits, type Address, type Hex, type PrivateKeyAccount } from "viem";
import { orderDigest, orderTypedData, type Order } from "@numa/shared";

export interface SignedOrder {
  order: Order;
  digest: Hex;
  merchantSig: Hex;
  merchant: Address;
}

/**
 * Merchant order service: signs EIP-712 orders with the merchant's payout-signer key.
 * The signer address MUST equal the campaign's authorized payout signer on-chain.
 */
export class OrderService {
  constructor(
    private readonly signer: PrivateKeyAccount,
    private readonly chainId: number,
    private readonly router: Address,
    private readonly ttlSeconds: number,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async createOrder(input: { campaignId: bigint; creator: Address; amount: string; orderId?: Hex }): Promise<SignedOrder> {
    const amount = parseUnits(input.amount, 6);
    if (amount <= 0n) throw new Error("amount must be positive");
    const order: Order = {
      campaignId: input.campaignId,
      orderId: input.orderId ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
      creator: input.creator,
      amount,
      deadline: BigInt(this.now() + this.ttlSeconds),
    };
    const merchantSig = await this.signer.signTypedData(orderTypedData(order, this.chainId, this.router));
    return { order, digest: orderDigest(order, this.chainId, this.router), merchantSig, merchant: this.signer.address };
  }
}

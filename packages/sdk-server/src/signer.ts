import { randomBytes } from "node:crypto";
import { parseUnits, type Address, type Hex, type PrivateKeyAccount } from "viem";
import { deriveAuthNonce, orderDigest, orderTypedData, type Order } from "@numa/shared";

export interface SignedOrder {
  order: Order;
  digest: Hex;
  /** EIP-3009 nonce the buyer must authorize: keccak256(abi.encode(digest, creator)). */
  authNonce: Hex;
  merchantSig: Hex;
  merchant: Address;
}

/**
 * Signs EIP-712 orders with a merchant payout-signer key. The signer address MUST equal the
 * campaign's authorized payout signer on-chain, or the router will reject the order.
 */
export class OrderSigner {
  constructor(
    private readonly signer: PrivateKeyAccount,
    private readonly chainId: number,
    private readonly router: Address,
    private readonly ttlSeconds: number,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  get address(): Address { return this.signer.address; }

  async createOrder(input: { campaignId: bigint; creator: Address; amount: string; orderId?: Hex }): Promise<SignedOrder> {
    if (!/^\d+(\.\d{1,6})?$/.test(input.amount)) throw new Error("amount must be a decimal string with at most 6 decimals");
    const amount = parseUnits(input.amount, 6);
    if (amount <= 0n) throw new Error("amount must be positive");
    const order: Order = {
      campaignId: input.campaignId,
      orderId: input.orderId ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
      creator: input.creator,
      amount,
      deadline: BigInt(this.now() + this.ttlSeconds),
    };
    const digest = orderDigest(order, this.chainId, this.router);
    const merchantSig = await this.signer.signTypedData(orderTypedData(order, this.chainId, this.router));
    return { order, digest, authNonce: deriveAuthNonce(digest, order.creator), merchantSig, merchant: this.signer.address };
  }
}

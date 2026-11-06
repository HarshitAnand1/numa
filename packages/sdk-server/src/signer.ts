import { randomBytes } from "node:crypto";
import { parseUnits, type Address, type Hex, type PrivateKeyAccount } from "viem";
import { computeOrderCommitment, orderDigest, orderTypedData, type Order } from "@numa/shared";

export interface SignedOrder {
  order: Order;
  digest: Hex;
  /** EIP-3009 nonce the buyer must authorize: computeOrderCommitment(order, commissionBps, feeBps). */
  authNonce: Hex;
  merchantSig: Hex;
  /** The campaign's payout-signer address (distinct from `order.merchant`, the actual merchant). */
  payoutSigner: Address;
}

/**
 * Signs EIP-712 orders with a merchant payout-signer key. The signer address MUST equal the
 * campaign's authorized payout signer on-chain, or the router will reject the order.
 *
 * `createOrder` takes `merchant`, `commissionBps` and `feeBps` per call (not fixed at
 * construction) so one `OrderSigner` instance can serve multiple campaigns - callers should read
 * these from `CampaignRegistry.getCampaign(campaignId)` and `NumaRouter.feeBps()` before calling.
 * Both are immutable on-chain for a given campaign/router deployment (no setter exists for
 * either), so they are safe to cache per campaignId rather than fetching on every call. The
 * buyer's EIP-3009 authorization nonce must equal `computeOrderCommitment(order, commissionBps,
 * feeBps)` - see docs/DECISIONS/0005-order-commitment-nonce-binding.md.
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

  async createOrder(input: {
    campaignId: bigint; merchant: Address; creator: Address; buyer: Address;
    amount: string; commissionBps: bigint; feeBps: bigint; orderId?: Hex;
  }): Promise<SignedOrder> {
    if (!/^\d+(\.\d{1,6})?$/.test(input.amount)) throw new Error("amount must be a decimal string with at most 6 decimals");
    const gross = parseUnits(input.amount, 6);
    if (gross <= 0n) throw new Error("amount must be positive");
    const order: Order = {
      campaignId: input.campaignId,
      merchant: input.merchant,
      creator: input.creator,
      buyer: input.buyer,
      gross,
      orderId: input.orderId ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
      deadline: BigInt(this.now() + this.ttlSeconds),
    };
    const digest = orderDigest(order, this.chainId, this.router);
    const merchantSig = await this.signer.signTypedData(orderTypedData(order, this.chainId, this.router));
    const authNonce = computeOrderCommitment(
      { campaignId: order.campaignId, merchant: order.merchant, creator: order.creator, buyer: order.buyer, gross: order.gross, commissionBps: input.commissionBps, feeBps: input.feeBps, orderId: order.orderId, deadline: order.deadline },
      this.chainId, this.router,
    );
    return { order, digest, authNonce, merchantSig, payoutSigner: this.signer.address };
  }
}

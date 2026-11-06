import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "@numa/shared";
import { OrderSigner } from "./signer.js";

export interface NumaOptions {
  campaignId: bigint | number | string;
  /** Merchant payout-signer private key. Keep server-side only. */
  signerKey: Hex;
  /** Deployed NumaRouter address (verifying contract of the order domain). */
  router: Address;
  chainId?: number;
  /** How long a signed order stays valid. Default 15 minutes. */
  ttlSeconds?: number;
}

/** JSON-safe order payload returned to the checkout (bigints as decimal strings). */
export interface OrderPayload {
  order: { campaignId: string; orderId: Hex; creator: Address; amount: string; deadline: string };
  digest: Hex;
  authNonce: Hex;
  merchantSig: Hex;
  merchant: Address;
  router: Address;
  chainId: number;
}

/**
 * Merchant-side entry point:
 *   const numa = new Numa({ campaignId: 7, signerKey, router });
 *   app.post("/api/order", async (req, res) => res.json(await numa.createOrder({ amount: "25.00", creator })));
 */
export class Numa {
  private readonly signer: OrderSigner;
  private readonly campaignId: bigint;
  private readonly chainId: number;

  constructor(private readonly opts: NumaOptions) {
    if (!isAddress(opts.router)) throw new Error("router must be an address");
    if (!/^0x[0-9a-fA-F]{64}$/.test(opts.signerKey)) throw new Error("signerKey must be 0x + 64 hex");
    this.campaignId = BigInt(opts.campaignId);
    this.chainId = opts.chainId ?? whitechainSepolia.id;
    this.signer = new OrderSigner(privateKeyToAccount(opts.signerKey), this.chainId, opts.router, opts.ttlSeconds ?? 900);
  }

  /** Address that must be set as the campaign's payout signer on-chain. */
  get signerAddress(): Address { return this.signer.address; }

  /** `creator` comes from the attribution link the buyer opened (after checking the Arkiv link owner). */
  async createOrder(input: { amount: string; creator: Address; orderId?: Hex }): Promise<OrderPayload> {
    if (!isAddress(input.creator)) throw new Error("creator must be an address");
    const o = await this.signer.createOrder({ campaignId: this.campaignId, ...input });
    return {
      order: { campaignId: o.order.campaignId.toString(), orderId: o.order.orderId, creator: o.order.creator, amount: o.order.amount.toString(), deadline: o.order.deadline.toString() },
      digest: o.digest, authNonce: o.authNonce, merchantSig: o.merchantSig, merchant: o.merchant, router: this.opts.router, chainId: this.chainId,
    };
  }
}

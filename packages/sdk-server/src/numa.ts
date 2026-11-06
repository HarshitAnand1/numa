import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "@numa/shared";
import { OrderSigner } from "./signer.js";

export interface NumaOptions {
  campaignId: bigint | number | string;
  /** The campaign's actual merchant address (`CampaignRegistry.getCampaign(campaignId).merchant`) -
   * distinct from the payout-signer key below. The router requires `order.merchant` to equal this
   * on-chain value exactly. */
  merchant: Address;
  /** Merchant payout-signer private key. Keep server-side only. Its derived address must equal
   * the campaign's `payoutSigner` on-chain, or the router rejects the order. */
  signerKey: Hex;
  /** Deployed NumaRouter address (verifying contract of the order domain). */
  router: Address;
  /** The campaign's commission rate in basis points (`getCampaign(campaignId).commissionBps`).
   * Immutable on-chain for the campaign's lifetime; read once and pass in here. Required to
   * compute the buyer's EIP-3009 authorization nonce - see
   * docs/DECISIONS/0005-order-commitment-nonce-binding.md. */
  commissionBps: bigint | number;
  /** The router's protocol fee in basis points (`NumaRouter.feeBps()`). Immutable per deployment. */
  feeBps: bigint | number;
  chainId?: number;
  /** How long a signed order stays valid. Default 15 minutes. */
  ttlSeconds?: number;
}

/** JSON-safe order payload returned to the checkout (bigints as decimal strings). */
export interface OrderPayload {
  order: { campaignId: string; merchant: Address; creator: Address; buyer: Address; amount: string; orderId: Hex; deadline: string };
  digest: Hex;
  /** The nonce the buyer must use when signing the EIP-3009 USDT authorization. */
  authNonce: Hex;
  merchantSig: Hex;
  /** The campaign's payout-signer address (distinct from `order.merchant`). */
  payoutSigner: Address;
  router: Address;
  chainId: number;
}

/**
 * Merchant-side entry point:
 *   const numa = new Numa({ campaignId: 7, merchant, signerKey, router, commissionBps, feeBps });
 *   app.post("/api/order", async (req, res) => res.json(await numa.createOrder({ amount: "25.00", creator, buyer })));
 */
export class Numa {
  private readonly signer: OrderSigner;
  private readonly campaignId: bigint;
  private readonly chainId: number;
  private readonly merchant: Address;
  private readonly commissionBps: bigint;
  private readonly feeBps: bigint;

  constructor(private readonly opts: NumaOptions) {
    if (!isAddress(opts.router)) throw new Error("router must be an address");
    if (!isAddress(opts.merchant)) throw new Error("merchant must be an address");
    if (!/^0x[0-9a-fA-F]{64}$/.test(opts.signerKey)) throw new Error("signerKey must be 0x + 64 hex");
    this.campaignId = BigInt(opts.campaignId);
    this.merchant = opts.merchant;
    this.commissionBps = BigInt(opts.commissionBps);
    this.feeBps = BigInt(opts.feeBps);
    this.chainId = opts.chainId ?? whitechainSepolia.id;
    this.signer = new OrderSigner(privateKeyToAccount(opts.signerKey), this.chainId, opts.router, opts.ttlSeconds ?? 900);
  }

  /** The campaign's payout-signer address - must be set as the campaign's payout signer on-chain. */
  get signerAddress(): Address { return this.signer.address; }

  /** `creator` comes from the attribution link the buyer opened (after checking the Arkiv link owner).
   * `buyer` is the connected wallet address that will pay - the merchant signs who the expected
   * buyer is as part of the order, so it must be known before the order is signed. */
  async createOrder(input: { amount: string; creator: Address; buyer: Address; orderId?: Hex }): Promise<OrderPayload> {
    if (!isAddress(input.creator)) throw new Error("creator must be an address");
    if (!isAddress(input.buyer)) throw new Error("buyer must be an address");
    const o = await this.signer.createOrder({
      campaignId: this.campaignId, merchant: this.merchant, commissionBps: this.commissionBps, feeBps: this.feeBps, ...input,
    });
    return {
      order: {
        campaignId: o.order.campaignId.toString(), merchant: o.order.merchant, creator: o.order.creator,
        buyer: o.order.buyer, amount: o.order.gross.toString(), orderId: o.order.orderId, deadline: o.order.deadline.toString(),
      },
      digest: o.digest, authNonce: o.authNonce, merchantSig: o.merchantSig, payoutSigner: o.payoutSigner,
      router: this.opts.router, chainId: this.chainId,
    };
  }
}

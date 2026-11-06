import {
  campaignRegistryAbi,
  computeOrderCommitment,
  numaRouterAbi,
  orderCommitmentFromOrder,
  orderDigest,
  receiveAuthTypedData,
  USDT_DECIMALS,
  type Order,
} from "@numa/shared";
import { isAddress, isHex, parseSignature, recoverAddress, type Address, type Hex, type PublicClient } from "viem";

/**
 * Pure checkout logic, no React and no wallet: validating an order before the buyer signs it,
 * building the USDT authorization, and shaping the relay request.
 *
 * The guiding rule: the order service is not trusted. Before the buyer's wallet is asked to
 * sign anything, we re-derive the order's terms from the chain (campaign merchant, payout
 * signer, commission, protocol fee) and refuse to proceed unless the server's order matches
 * what the buyer asked for AND what the contracts will enforce.
 */

export type SigningErrorCode =
  | "BAD_AMOUNT"
  | "BAD_PAYLOAD"
  | "ORDER_MISMATCH"
  | "ORDER_EXPIRED"
  | "MERCHANT_MISMATCH"
  | "SIGNER_MISMATCH"
  | "NONCE_MISMATCH"
  | "CAMPAIGN_NOT_SETTLEABLE"
  | "CREATOR_NOT_APPROVED"
  | "CONTRACTS_UNAVAILABLE"
  | "INSUFFICIENT_USDT";

export class SigningError extends Error {
  constructor(
    readonly code: SigningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SigningError";
  }
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const UINT = /^\d{1,78}$/;
/** An order that expires within this window is refused: the buyer would sign, then the relay would fail. */
export const MIN_ORDER_SECONDS_LEFT = 30;

/** "25.00" -> 25_000_000n. At most 6 decimals, strictly positive. */
export function parseUsdtAmount(amount: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) {
    throw new SigningError("BAD_AMOUNT", "Amount must be a number with at most 6 decimals.");
  }
  const [whole = "0", frac = ""] = amount.split(".");
  const v = BigInt(whole) * 10n ** BigInt(USDT_DECIMALS) + BigInt(frac.padEnd(USDT_DECIMALS, "0"));
  if (v <= 0n) throw new SigningError("BAD_AMOUNT", "Amount must be greater than zero.");
  return v;
}

/** The same integer split NumaRouter performs: every share rounds down, the merchant gets the remainder. */
export function splitAmounts(gross: bigint, commissionBps: bigint, feeBps: bigint) {
  const commission = (gross * commissionBps) / 10_000n;
  const fee = (gross * feeBps) / 10_000n;
  return { commission, fee, merchantNet: gross - commission - fee };
}

/** What `POST /orders` returns (bigints arrive as decimal strings). */
export interface OrderPayload {
  order: Record<"campaignId" | "merchant" | "creator" | "buyer" | "gross" | "orderId" | "deadline", string>;
  digest?: string;
  authNonce: string;
  merchantSig: string;
  payoutSigner?: string;
}

/** What the buyer asked to pay: the only thing we trust. */
export interface Expected {
  campaignId: string;
  creator: Address;
  buyer: Address;
  amount: string;
}

/** Facts read from the contracts. */
export interface ChainTerms {
  merchant: Address;
  payoutSigner: Address;
  commissionBps: bigint;
  feeBps: bigint;
  settleable: boolean;
  creatorApproved: boolean;
}

export interface VerifiedOrder {
  order: Order;
  authNonce: Hex;
  merchantSig: Hex;
  split: ReturnType<typeof splitAmounts>;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function need(cond: boolean, code: SigningErrorCode, message: string): asserts cond {
  if (!cond) throw new SigningError(code, message);
}

export async function verifyOrderPayload(args: {
  payload: OrderPayload;
  expected: Expected;
  terms: ChainTerms;
  router: Address;
  chainId: number;
  now?: number;
}): Promise<VerifiedOrder> {
  const { payload: p, expected, terms, router, chainId } = args;
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const o = p?.order;

  need(!!o && !!p.authNonce && !!p.merchantSig, "BAD_PAYLOAD", "The order service returned an incomplete order.");
  for (const k of ["merchant", "creator", "buyer"] as const) {
    need(typeof o[k] === "string" && isAddress(o[k]), "BAD_PAYLOAD", `Order has an invalid ${k} address.`);
  }
  for (const k of ["campaignId", "gross", "deadline"] as const) {
    need(typeof o[k] === "string" && UINT.test(o[k]), "BAD_PAYLOAD", `Order has an invalid ${k}.`);
  }
  need(BYTES32.test(o.orderId ?? ""), "BAD_PAYLOAD", "Order has an invalid orderId.");
  need(BYTES32.test(p.authNonce), "BAD_PAYLOAD", "Order has an invalid authorization nonce.");
  need(SIGNATURE.test(p.merchantSig), "BAD_PAYLOAD", "Order has an invalid merchant signature.");

  // 1) It is the order the buyer asked for.
  need(same(o.buyer, expected.buyer), "ORDER_MISMATCH", "The order is for a different buyer wallet.");
  need(same(o.creator, expected.creator), "ORDER_MISMATCH", "The order credits a different creator.");
  need(o.campaignId === expected.campaignId, "ORDER_MISMATCH", "The order is for a different campaign.");
  need(
    BigInt(o.gross) === parseUsdtAmount(expected.amount),
    "ORDER_MISMATCH",
    "The order amount differs from the amount you were shown.",
  );
  need(
    BigInt(o.deadline) > BigInt(now + MIN_ORDER_SECONDS_LEFT),
    "ORDER_EXPIRED",
    "The order is about to expire. Start the payment again.",
  );

  // 2) It is what the contracts will enforce.
  need(terms.settleable, "CAMPAIGN_NOT_SETTLEABLE", "This campaign is paused, ended or unknown on-chain.");
  need(terms.creatorApproved, "CREATOR_NOT_APPROVED", "This creator is not approved for the campaign.");
  need(same(o.merchant, terms.merchant), "MERCHANT_MISMATCH", "The order's merchant is not the campaign's on-chain merchant.");

  const order: Order = {
    campaignId: BigInt(o.campaignId),
    merchant: o.merchant as Address,
    creator: o.creator as Address,
    buyer: o.buyer as Address,
    gross: BigInt(o.gross),
    orderId: o.orderId as Hex,
    deadline: BigInt(o.deadline),
  };

  // The merchant signature must come from the campaign's payout signer, exactly as the router checks.
  const signer = await recoverAddress({ hash: orderDigest(order, chainId, router), signature: p.merchantSig as Hex }).catch(
    () => undefined,
  );
  need(!!signer && same(signer, terms.payoutSigner), "SIGNER_MISMATCH", "The order was not signed by the campaign's payout signer.");

  // The nonce the buyer signs commits to the full split; recompute it instead of trusting the server.
  const expectedNonce = computeOrderCommitment(orderCommitmentFromOrder(order, terms.commissionBps, terms.feeBps), chainId, router);
  need(same(expectedNonce, p.authNonce), "NONCE_MISMATCH", "The authorization nonce does not match the on-chain split terms.");

  return {
    order,
    authNonce: p.authNonce as Hex,
    merchantSig: p.merchantSig as Hex,
    split: splitAmounts(order.gross, terms.commissionBps, terms.feeBps),
  };
}

/** Read everything verifyOrderPayload needs from the contracts. Throws CONTRACTS_UNAVAILABLE on any failure. */
export async function readChainTerms(args: {
  client: Pick<PublicClient, "readContract">;
  registry: Address;
  router: Address;
  campaignId: bigint;
  creator: Address;
}): Promise<ChainTerms> {
  const { client, registry, router, campaignId, creator } = args;
  try {
    const [campaign, settleable, creatorApproved, feeBps] = await Promise.all([
      client.readContract({ address: registry, abi: campaignRegistryAbi, functionName: "getCampaign", args: [campaignId] }),
      client.readContract({ address: registry, abi: campaignRegistryAbi, functionName: "isSettleable", args: [campaignId] }),
      client.readContract({ address: registry, abi: campaignRegistryAbi, functionName: "isCreatorApproved", args: [campaignId, creator] }),
      client.readContract({ address: router, abi: numaRouterAbi, functionName: "feeBps" }),
    ]);
    return {
      merchant: campaign.merchant,
      payoutSigner: campaign.payoutSigner,
      commissionBps: BigInt(campaign.commissionBps),
      feeBps: BigInt(feeBps),
      settleable,
      creatorApproved,
    };
  } catch {
    throw new SigningError("CONTRACTS_UNAVAILABLE", "Couldn't read the campaign from Whitechain. Check your connection and try again.");
  }
}

/**
 * The authorization lives exactly as long as the order: valid immediately, void at the order's
 * deadline. A leaked signature is therefore useless after the order would have expired anyway.
 */
export function authorizationWindow(order: Order): { validAfter: bigint; validBefore: bigint } {
  return { validAfter: 0n, validBefore: order.deadline };
}

/** EIP-712 typed data the buyer's wallet signs (EIP-3009 receiveWithAuthorization, to = router). */
export function buildAuthTypedData(v: VerifiedOrder, router: Address, chainId: number, token: Address) {
  const { validAfter, validBefore } = authorizationWindow(v.order);
  return receiveAuthTypedData(
    { from: v.order.buyer, router, value: v.order.gross, validAfter, validBefore, nonce: v.authNonce },
    chainId,
    token,
  );
}

/** 65-byte signature -> the v (27/28), r, s the relayer and USDT contract take. */
export function splitSignature(signature: Hex): { v: 27 | 28; r: Hex; s: Hex } {
  need(isHex(signature) && SIGNATURE.test(signature), "BAD_PAYLOAD", "The wallet returned a malformed signature.");
  const sig = parseSignature(signature);
  const raw = sig.v !== undefined ? Number(sig.v) : sig.yParity + 27;
  const v = raw < 27 ? raw + 27 : raw;
  need(v === 27 || v === 28, "BAD_PAYLOAD", "The wallet returned a signature with an invalid recovery id.");
  return { v: v as 27 | 28, r: sig.r, s: sig.s };
}

/** Body for `POST /relay` (decimal strings for every uint, as the API's schema requires). */
export function toRelayBody(v: VerifiedOrder, signature: Hex) {
  const { validAfter, validBefore } = authorizationWindow(v.order);
  const { v: sigV, r, s } = splitSignature(signature);
  const o = v.order;
  return {
    order: {
      campaignId: o.campaignId.toString(),
      merchant: o.merchant,
      creator: o.creator,
      buyer: o.buyer,
      gross: o.gross.toString(),
      orderId: o.orderId,
      deadline: o.deadline.toString(),
    },
    merchantSig: v.merchantSig,
    auth: { validAfter: validAfter.toString(), validBefore: validBefore.toString(), v: sigV, r, s },
  };
}

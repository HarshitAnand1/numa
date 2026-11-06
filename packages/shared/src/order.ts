import { hashTypedData, type Address, type Hex } from "viem";

/**
 * The merchant signs this struct (EIP-712). Matches
 * packages/contracts/src/interfaces/INumaRouter.sol's Order exactly - field order and types.
 * Domain: name "NumaRouter", version "1", chainId, verifyingContract = router address.
 */
export interface Order {
  campaignId: bigint;
  merchant: Address;
  creator: Address;
  buyer: Address;
  gross: bigint; // USDT, 6 decimals
  orderId: Hex; // bytes32, unique per purchase
  deadline: bigint; // unix seconds
}

export const ORDER_DOMAIN_NAME = "NumaRouter";
export const ORDER_DOMAIN_VERSION = "1";

export const orderTypes = {
  Order: [
    { name: "campaignId", type: "uint256" },
    { name: "merchant", type: "address" },
    { name: "creator", type: "address" },
    { name: "buyer", type: "address" },
    { name: "gross", type: "uint256" },
    { name: "orderId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function orderTypedData(order: Order, chainId: number, router: Address) {
  return {
    domain: { name: ORDER_DOMAIN_NAME, version: ORDER_DOMAIN_VERSION, chainId, verifyingContract: router },
    types: orderTypes,
    primaryType: "Order" as const,
    message: order,
  };
}

export function orderDigest(order: Order, chainId: number, router: Address): Hex {
  return hashTypedData(orderTypedData(order, chainId, router));
}

/**
 * OrderCommitment: the buyer's EIP-3009 authorization `nonce` (passed to payOrder as
 * `authNonce`) must equal this digest. Matches packages/contracts/src/NumaRouter.sol's
 * ORDER_COMMITMENT_TYPEHASH exactly - field order and types. Note `uint96` (not `uint256`) for
 * commissionBps/feeBps: the EIP-712 typehash is a hash of the literal type-signature string, so a
 * width mismatch here silently produces a different, non-matching digest even though the encoded
 * bytes for the same numeric value are identical. See
 * docs/DECISIONS/0005-order-commitment-nonce-binding.md for the full rationale, and
 * packages/contracts/test/NumaRouter.t.sol::test_fixedVector_orderCommitmentMatchesCrossLanguageSpec
 * for the fixed cross-language test vector this must agree with byte-for-byte.
 */
export interface OrderCommitmentInput {
  campaignId: bigint;
  merchant: Address;
  creator: Address;
  buyer: Address;
  gross: bigint;
  commissionBps: bigint;
  feeBps: bigint;
  orderId: Hex;
  deadline: bigint;
}

export const orderCommitmentTypes = {
  OrderCommitment: [
    { name: "campaignId", type: "uint256" },
    { name: "merchant", type: "address" },
    { name: "creator", type: "address" },
    { name: "buyer", type: "address" },
    { name: "gross", type: "uint256" },
    { name: "commissionBps", type: "uint96" },
    { name: "feeBps", type: "uint96" },
    { name: "orderId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function orderCommitmentTypedData(input: OrderCommitmentInput, chainId: number, router: Address) {
  return {
    domain: { name: ORDER_DOMAIN_NAME, version: ORDER_DOMAIN_VERSION, chainId, verifyingContract: router },
    types: orderCommitmentTypes,
    primaryType: "OrderCommitment" as const,
    message: input,
  };
}

/** The value the buyer's EIP-3009 authorization `nonce` must equal for `payOrder` to accept it. */
export function computeOrderCommitment(input: OrderCommitmentInput, chainId: number, router: Address): Hex {
  return hashTypedData(orderCommitmentTypedData(input, chainId, router));
}

/** Convenience: build the commitment input directly from a signed Order + on-chain split terms. */
export function orderCommitmentFromOrder(order: Order, commissionBps: bigint, feeBps: bigint): OrderCommitmentInput {
  return {
    campaignId: order.campaignId,
    merchant: order.merchant,
    creator: order.creator,
    buyer: order.buyer,
    gross: order.gross,
    commissionBps,
    feeBps,
    orderId: order.orderId,
    deadline: order.deadline,
  };
}

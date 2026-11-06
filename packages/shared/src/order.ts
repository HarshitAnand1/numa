import { encodeAbiParameters, hashTypedData, keccak256, type Address, type Hex } from "viem";

/**
 * PROPOSED interface — must be agreed with Member 1 (contracts) before the router is final.
 * The merchant signs this struct (EIP-712). Domain: name "NumaRouter", version "1",
 * chainId, verifyingContract = router address.
 */
export interface Order {
  campaignId: bigint;
  orderId: Hex; // bytes32, unique per purchase
  creator: Address;
  amount: bigint; // gross USDT, 6 decimals
  deadline: bigint; // unix seconds
}

export const ORDER_DOMAIN_NAME = "NumaRouter";
export const ORDER_DOMAIN_VERSION = "1";

export const orderTypes = {
  Order: [
    { name: "campaignId", type: "uint256" },
    { name: "orderId", type: "bytes32" },
    { name: "creator", type: "address" },
    { name: "amount", type: "uint256" },
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
 * EIP-3009 nonce the buyer authorizes: keccak256(abi.encode(orderDigest, creator)).
 * Binds the USDT authorization to exactly one order and creator.
 */
export function deriveAuthNonce(digest: Hex, creator: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [digest, creator]));
}

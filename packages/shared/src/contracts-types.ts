/// TypeScript mirrors of NumaRouter.sol's Order struct and events. Keep in sync with
/// packages/contracts/src/interfaces/INumaRouter.sol — this is the handoff contract to
/// Member 2 (relayer/backend) and Member 3 (frontend/SDK) per TEAM.md.

export type Order = {
  campaignId: bigint;
  merchant: `0x${string}`;
  creator: `0x${string}`;
  buyer: `0x${string}`;
  gross: bigint;
  orderId: `0x${string}`;
  deadline: bigint;
};

/// EIP-712 domain for NumaRouter order signing. `verifyingContract` is the deployed NumaRouter
/// address for the target chain (see ./addresses.ts).
export const NUMA_ROUTER_EIP712_DOMAIN_NAME = "NumaRouter";
export const NUMA_ROUTER_EIP712_DOMAIN_VERSION = "1";

export const ORDER_EIP712_TYPES = {
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

/// OrderCommitment: the buyer's EIP-3009 `nonce` (passed to payOrder as `authNonce`) must equal
/// this EIP-712 digest, computed over the complete order + split terms. See
/// docs/DECISIONS/0005-order-commitment-nonce-binding.md for the full rationale. Field order and
/// types here MUST exactly match packages/contracts/src/NumaRouter.sol's
/// ORDER_COMMITMENT_TYPEHASH byte-for-byte, including `uint96` (not `uint256`) for
/// commissionBps/feeBps — a width mismatch in the type string produces a different, silently
/// non-matching digest despite encoding the same numeric values. A fixed cross-language test
/// vector exists in packages/contracts/test/NumaRouter.t.sol
/// (`test_fixedVector_orderCommitmentMatchesCrossLanguageSpec`) — a matching TypeScript test
/// against the same literal expected digest is required before this is used in the relayer.
export type OrderCommitment = {
  campaignId: bigint;
  merchant: `0x${string}`;
  creator: `0x${string}`;
  buyer: `0x${string}`;
  gross: bigint;
  commissionBps: bigint; // uint96 on-chain; pass as bigint, viem encodes per the declared type below
  feeBps: bigint; // uint96 on-chain
  orderId: `0x${string}`;
  deadline: bigint;
};

export const ORDER_COMMITMENT_EIP712_TYPES = {
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

/// Fixed cross-language test vector (see docs/DECISIONS/0005-order-commitment-nonce-binding.md
/// and packages/contracts/test/NumaRouter.t.sol::test_fixedVector_orderCommitmentMatchesCrossLanguageSpec).
/// Computing hashTypedData({domain: ORDER_COMMITMENT_TEST_VECTOR_DOMAIN, types:
/// ORDER_COMMITMENT_EIP712_TYPES, primaryType: "OrderCommitment", message:
/// ORDER_COMMITMENT_TEST_VECTOR}) must equal ORDER_COMMITMENT_TEST_VECTOR_EXPECTED_DIGEST exactly.
export const ORDER_COMMITMENT_TEST_VECTOR_DOMAIN = {
  name: NUMA_ROUTER_EIP712_DOMAIN_NAME,
  version: NUMA_ROUTER_EIP712_DOMAIN_VERSION,
  chainId: 1874,
  verifyingContract: "0x4444444444444444444444444444444444444444",
} as const;

export const ORDER_COMMITMENT_TEST_VECTOR: OrderCommitment = {
  campaignId: 7n,
  merchant: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  buyer: "0x3333333333333333333333333333333333333333",
  gross: 100_000_000n,
  commissionBps: 1000n,
  feeBps: 50n,
  orderId: "0x000000000000000000000000000000000000000000000000000000000000002a",
  deadline: 2_000_000_000n,
};

export const ORDER_COMMITMENT_TEST_VECTOR_EXPECTED_DIGEST: `0x${string}` =
  "0x47a0866ddbb8f61bab6637439ff2adec7b94c8afb8dc57cef34220918142f1cb";

/// Event names emitted by NumaRouter, for the backend indexer (Member 2) and reputation service.
export const NUMA_ROUTER_EVENTS = {
  OrderSettled: "OrderSettled",
  OrderRefunded: "OrderRefunded",
  CommissionReleased: "CommissionReleased",
} as const;

/// Event names emitted by CampaignRegistry.
export const CAMPAIGN_REGISTRY_EVENTS = {
  CampaignCreated: "CampaignCreated",
  CreatorApproved: "CreatorApproved",
  CreatorRevoked: "CreatorRevoked",
  CampaignPaused: "CampaignPaused",
} as const;

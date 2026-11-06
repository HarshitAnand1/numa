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

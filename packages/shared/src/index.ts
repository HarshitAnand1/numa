// Member 2 (backend) — existing modules, already consumed by packages/sdk-server and apps/api.
// Left exactly as-is (unrenamed) so their existing imports from "@numa/shared" keep working.
export * from "./chain.js";
export * from "./order.js";
export * from "./usdt.js";
export * from "./abi.js";
export * from "./schemas.js";

// Member 1 (contracts) — ABIs, deployed addresses, and the EIP-712 Order type for the contracts
// actually implemented and shipped (packages/contracts/src/interfaces/INumaRouter.sol).
//
// Two names would otherwise collide with Member 2's exports above, which are already consumed
// and must not be renamed — see docs/PROJECT_STATUS.md -> "Interface reconciliation" for the
// full list of gaps between the two:
//   - "Order": Member 2's ./order.js exports an Order type for a PRE-IMPLEMENTATION PROPOSAL
//     with a different shape (no `merchant`/`buyer` fields, `amount` instead of `gross`). The
//     real, implemented Order is re-exported below as "NumaRouterOrder" so it can never be
//     silently confused with the proposal.
//   - "USDT_ADDRESS": ./chain.js already exports this with the identical value, so it is not
//     re-exported again here.
export * from "./abis";
export { WHITECHAIN_SEPOLIA_CHAIN_ID, DEPLOYED_ADDRESSES } from "./addresses";
export type { DeployedAddresses } from "./addresses";
export type { Order as NumaRouterOrder } from "./contracts-types";
export {
  NUMA_ROUTER_EIP712_DOMAIN_NAME,
  NUMA_ROUTER_EIP712_DOMAIN_VERSION,
  ORDER_EIP712_TYPES,
  NUMA_ROUTER_EVENTS,
  CAMPAIGN_REGISTRY_EVENTS,
} from "./contracts-types";

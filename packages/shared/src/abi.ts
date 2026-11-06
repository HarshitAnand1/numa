import { parseAbi } from "viem";

/**
 * NumaRouter ABI, matching packages/contracts/src/NumaRouter.sol exactly:
 * - `payOrder`'s Order tuple includes `merchant` and `buyer` (the merchant signs who the buyer
 *   must be); `authNonce` is a required, explicit parameter that must equal
 *   `computeOrderCommitment(order, commissionBps, feeBps)` - see
 *   docs/DECISIONS/0005-order-commitment-nonce-binding.md and packages/shared/src/order.ts.
 * - `OrderSettled` indexes `orderId`, `campaignId`, `merchant` (not `creator`).
 * - `OrderRefunded` includes `merchantPulled`.
 */
export const numaRouterAbi = parseAbi([
  "function payOrder((uint256 campaignId, address merchant, address creator, address buyer, uint256 gross, bytes32 orderId, uint256 deadline) order, bytes merchantSignature, uint256 validAfter, uint256 validBefore, bytes32 authNonce, uint8 v, bytes32 r, bytes32 s)",
  "function computeOrderCommitment((uint256 campaignId, address merchant, address creator, address buyer, uint256 gross, bytes32 orderId, uint256 deadline) order, uint96 commissionBps, uint96 feeBps) view returns (bytes32)",
  "function feeBps() view returns (uint96)",
  "event OrderSettled(bytes32 indexed orderId, uint256 indexed campaignId, address indexed merchant, address creator, address buyer, uint256 gross, uint256 merchantNet, uint256 commission, uint256 fee)",
  "event OrderRefunded(bytes32 indexed orderId, uint256 refundAmount, uint256 commissionClawback, uint256 merchantPulled)",
  "event CommissionReleased(bytes32 indexed orderId, address indexed creator, uint256 amount)",
]);

/**
 * CampaignRegistry ABI, matching packages/contracts/src/CampaignRegistry.sol exactly. There is
 * no `merchantOf` function - the merchant address is `getCampaign(campaignId).merchant` (a field
 * on the returned `Campaign` tuple). See docs/PROJECT_STATUS.md -> "Interface reconciliation".
 */
export const campaignRegistryAbi = parseAbi([
  "function getCampaign(uint256 campaignId) view returns ((address merchant, address payoutSigner, uint96 commissionBps, uint64 endsAt, bool paused, bool exists))",
  "function isCreatorApproved(uint256 campaignId, address creator) view returns (bool)",
  "function isSettleable(uint256 campaignId) view returns (bool)",
]);

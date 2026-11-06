import { parseAbi } from "viem";

/**
 * PROPOSED router ABI (Member 1 owns the real one; replace with generated ABI once NumaRouter exists).
 */
export const numaRouterAbi = parseAbi([
  "function payOrder((uint256 campaignId, bytes32 orderId, address creator, uint256 amount, uint256 deadline) order, bytes merchantSig, address buyer, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)",
  "event OrderSettled(bytes32 indexed orderId, uint256 indexed campaignId, address indexed creator, address merchant, address buyer, uint256 gross, uint256 merchantNet, uint256 commission, uint256 fee)",
  "event OrderRefunded(bytes32 indexed orderId, uint256 refundAmount, uint256 commissionClawback)",
  "event CommissionReleased(bytes32 indexed orderId, address indexed creator, uint256 amount)",
]);

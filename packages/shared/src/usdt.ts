import type { Address, Hex } from "viem";
import { USDT_ADDRESS, USDT_DOMAIN_NAME, USDT_DOMAIN_VERSION } from "./chain.js";

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Typed data the BUYER signs (to = router, since receiveWithAuthorization needs msg.sender == to). */
export function receiveAuthTypedData(
  args: { from: Address; router: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex },
  chainId: number,
  token: Address = USDT_ADDRESS,
) {
  return {
    domain: { name: USDT_DOMAIN_NAME, version: USDT_DOMAIN_VERSION, chainId, verifyingContract: token },
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: args.from, to: args.router, value: args.value,
      validAfter: args.validAfter, validBefore: args.validBefore, nonce: args.nonce,
    },
  };
}

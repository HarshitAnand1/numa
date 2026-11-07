import type { Hex } from "viem";
import { relayRequest, type RelayRequest } from "./schemas.js";

/** The buyer's EIP-3009 signature parts, as the checkout collects them. */
export interface BuyerAuth { validAfter: string; validBefore: string; v: 27 | 28; r: Hex; s: Hex }

/** What a merchant's order endpoint returns (and what the relayer needs back). */
export interface RelayableOrder {
  order: { campaignId: string; merchant: string; creator: string; buyer: string; gross: string; orderId: Hex; deadline: string };
  merchantSig: Hex;
}

/**
 * Builds the exact body for the relayer's `POST /relay`, validated against the shared schema so a field
 * mistake fails in the client or merchant server instead of at the relayer.
 */
export function toRelayRequest(payload: RelayableOrder, auth: BuyerAuth): RelayRequest {
  return relayRequest.parse({ order: payload.order, merchantSig: payload.merchantSig, auth });
}

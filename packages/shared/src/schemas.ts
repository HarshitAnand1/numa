import { isAddress, isHex } from "viem";
import { z } from "zod";

const address = z.string().refine((v) => isAddress(v), "invalid address").transform((v) => v as `0x${string}`);
const bytes32 = z.string().refine((v) => isHex(v) && v.length === 66, "invalid bytes32").transform((v) => v as `0x${string}`);
const hex = z.string().refine((v) => isHex(v), "invalid hex").transform((v) => v as `0x${string}`);
const uint = z.string().regex(/^\d+$/, "decimal string").transform((v) => BigInt(v));

export const createOrderRequest = z.object({
  campaignId: uint,
  orderId: bytes32.optional(),
  creator: address,
  /** Buyer's wallet address - the merchant signs who the expected buyer is as part of the order. */
  buyer: address,
  /** USDT amount as decimal string, e.g. "25.00" */
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

/**
 * `order.buyer` (not a separate top-level `buyer` field) is the single source of truth for who
 * is paying - duplicating it at the request's top level risked the two silently disagreeing.
 * `authNonce` is deliberately not accepted from the caller: the relayer always recomputes the
 * expected commitment itself from on-chain campaign/fee terms (see services/relayer.ts) and never
 * trusts a caller-supplied nonce, consistent with "do not trust a caller-supplied arbitrary nonce."
 */
export const relayRequest = z.object({
  order: z.object({
    campaignId: uint, merchant: address, creator: address, buyer: address, gross: uint, orderId: bytes32, deadline: uint,
  }),
  merchantSig: hex,
  auth: z.object({ validAfter: uint, validBefore: uint, v: z.number().int().min(27).max(28), r: bytes32, s: bytes32 }),
});
export type RelayRequest = z.infer<typeof relayRequest>;

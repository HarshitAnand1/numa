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
  /** USDT amount as decimal string, e.g. "25.00" */
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export const relayRequest = z.object({
  order: z.object({ campaignId: uint, orderId: bytes32, creator: address, amount: uint, deadline: uint }),
  merchantSig: hex,
  buyer: address,
  auth: z.object({ validAfter: uint, validBefore: uint, v: z.number().int().min(27).max(28), r: bytes32, s: bytes32 }),
});
export type RelayRequest = z.infer<typeof relayRequest>;

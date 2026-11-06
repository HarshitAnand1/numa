import { parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { numaRouterAbi } from "@numa/shared";

/** A conversion record as read from Arkiv (untrusted until verified). */
export interface ConversionClaim {
  creator: Address; merchant: Address; campaignId: bigint; gross: bigint; commission: bigint; txHash: Hex; orderId: Hex;
}
export interface VerifiedConversion extends ConversionClaim { buyer: Address; blockNumber: bigint }

export type VerifyResult = { ok: true; value: VerifiedConversion } | { ok: false; reason: string };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Check a claimed conversion against the router's OrderSettled event in the claimed tx. */
export async function verifyConversion(pub: PublicClient, router: Address, claim: ConversionClaim): Promise<VerifyResult> {
  let receipt;
  try { receipt = await pub.getTransactionReceipt({ hash: claim.txHash }); }
  catch { return { ok: false, reason: "tx not found" }; }
  if (receipt.status !== "success") return { ok: false, reason: "tx failed" };

  const logs = parseEventLogs({ abi: numaRouterAbi, eventName: "OrderSettled", logs: receipt.logs })
    .filter((l) => eq(l.address, router));
  const ev = logs.find((l) => eq(l.args.orderId, claim.orderId));
  if (!ev) return { ok: false, reason: "no OrderSettled for orderId from router" };
  const a = ev.args;
  if (!eq(a.creator, claim.creator)) return { ok: false, reason: "creator mismatch" };
  if (!eq(a.merchant, claim.merchant)) return { ok: false, reason: "merchant mismatch" };
  if (a.campaignId !== claim.campaignId) return { ok: false, reason: "campaign mismatch" };
  if (a.gross !== claim.gross) return { ok: false, reason: "gross mismatch" };
  if (a.commission !== claim.commission) return { ok: false, reason: "commission mismatch" };
  return { ok: true, value: { ...claim, buyer: a.buyer, blockNumber: receipt.blockNumber } };
}

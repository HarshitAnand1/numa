import { parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { numaRouterAbi } from "@numa/shared";

/** A conversion record as read from Arkiv (untrusted until verified). */
export interface ConversionClaim {
  creator: Address; merchant: Address; campaignId: bigint; gross: bigint; commission: bigint; txHash: Hex; orderId: Hex;
}
export interface VerifiedConversion extends ConversionClaim { buyer: Address; blockNumber: bigint }

export type VerifyResult = { ok: true; value: VerifiedConversion } | { ok: false; reason: string };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface SettledEvent {
  orderId: Hex; campaignId: bigint; creator: Address; merchant: Address; buyer: Address; gross: bigint; commission: bigint; blockNumber: bigint;
}

/** Fetch the router's OrderSettled event for `orderId` from the given tx, or explain why not. */
/** Opt-in cache of successful lookups (a settled event is final); pass the same Map across requests. */
export type SettledCache = Map<string, SettledEvent>;
const CACHE_MAX = 5000;

export async function findSettled(pub: PublicClient, router: Address, txHash: Hex, orderId: Hex, cache?: SettledCache): Promise<{ ok: true; value: SettledEvent } | { ok: false; reason: string }> {
  const ck = `${router}:${txHash}:${orderId}`.toLowerCase();
  const hit = cache?.get(ck);
  if (hit) return { ok: true, value: hit };
  const r = await lookup(pub, router, txHash, orderId);
  if (r.ok && cache) { if (cache.size >= CACHE_MAX) cache.clear(); cache.set(ck, r.value); }
  return r;
}

async function lookup(pub: PublicClient, router: Address, txHash: Hex, orderId: Hex): Promise<{ ok: true; value: SettledEvent } | { ok: false; reason: string }> {
  let receipt;
  try { receipt = await pub.getTransactionReceipt({ hash: txHash }); }
  catch { return { ok: false, reason: "tx not found" }; }
  if (receipt.status !== "success") return { ok: false, reason: "tx failed" };
  const logs = parseEventLogs({ abi: numaRouterAbi, eventName: "OrderSettled", logs: receipt.logs }).filter((l) => eq(l.address, router));
  const ev = logs.find((l) => eq(l.args.orderId, orderId));
  if (!ev) return { ok: false, reason: "no OrderSettled for orderId from router" };
  const a = ev.args;
  return { ok: true, value: { orderId: a.orderId, campaignId: a.campaignId, creator: a.creator, merchant: a.merchant, buyer: a.buyer, gross: a.gross, commission: a.commission, blockNumber: receipt.blockNumber } };
}

/** Check a claimed conversion against the router's OrderSettled event in the claimed tx. */
export async function verifyConversion(pub: PublicClient, router: Address, claim: ConversionClaim, cache?: SettledCache): Promise<VerifyResult> {
  const f = await findSettled(pub, router, claim.txHash, claim.orderId, cache);
  if (!f.ok) return f;
  const a = f.value;
  if (!eq(a.creator, claim.creator)) return { ok: false, reason: "creator mismatch" };
  if (!eq(a.merchant, claim.merchant)) return { ok: false, reason: "merchant mismatch" };
  if (a.campaignId !== claim.campaignId) return { ok: false, reason: "campaign mismatch" };
  if (a.gross !== claim.gross) return { ok: false, reason: "gross mismatch" };
  if (a.commission !== claim.commission) return { ok: false, reason: "commission mismatch" };
  return { ok: true, value: { ...claim, buyer: a.buyer, blockNumber: a.blockNumber } };
}

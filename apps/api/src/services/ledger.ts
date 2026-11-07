import { formatUnits, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { numaRouterAbi } from "@numa/shared";

export type LedgerStatus = "held" | "released" | "refunded" | "partially_refunded";

/** One settled order, rebuilt from chain events only (the chain is the source of truth, not Arkiv or Postgres). */
export interface LedgerRow {
  orderId: Hex; txHash: Hex; paidAt: number; campaignId: bigint; merchant: Address; creator: Address; buyer: Address;
  gross: bigint; merchantNet: bigint; commission: bigint; fee: bigint;
  refunded: bigint; commissionClawedBack: bigint; merchantPulled: bigint;
  commissionReleased: bigint; released: boolean; status: LedgerStatus;
}

export class LedgerRangeError extends Error {}

/**
 * Rebuilds the order ledger for `merchant` by reading router events in `[fromBlock, toBlock]`. Refund and release events
 * are not indexed by merchant, so every router log in the range is read and matched to the merchant's orders by orderId.
 * A request spanning more than `maxChunks * maxRange` blocks is refused so one call cannot hammer the RPC.
 */
export async function loadLedger(
  pub: Pick<PublicClient, "getBlockNumber" | "getLogs" | "getBlock">,
  router: Address,
  q: { merchant: Address; fromBlock: bigint; toBlock?: bigint; maxRange?: bigint; maxChunks?: number },
): Promise<LedgerRow[]> {
  const maxRange = q.maxRange ?? 2_000n, maxChunks = q.maxChunks ?? 200;
  const head = await pub.getBlockNumber();
  const to = q.toBlock !== undefined && q.toBlock < head ? q.toBlock : head;
  if (q.fromBlock > to) return [];
  if ((to - q.fromBlock) / maxRange >= BigInt(maxChunks)) throw new LedgerRangeError(`range too large: pass a fromBlock within the last ${Number(maxRange) * maxChunks} blocks`);

  const rows = new Map<Hex, LedgerRow>();
  const ts = new Map<bigint, number>();
  const want = q.merchant.toLowerCase();
  for (let from = q.fromBlock; from <= to; from += maxRange) {
    const end = from + maxRange - 1n < to ? from + maxRange - 1n : to;
    const logs = parseEventLogs({ abi: numaRouterAbi, logs: await pub.getLogs({ address: router, fromBlock: from, toBlock: end }) });
    logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);
    for (const ev of logs) {
      if (ev.eventName === "OrderSettled") {
        const a = ev.args;
        if (a.merchant.toLowerCase() !== want) continue;
        let t = ts.get(ev.blockNumber!);
        if (t === undefined) { t = Number((await pub.getBlock({ blockNumber: ev.blockNumber! })).timestamp); ts.set(ev.blockNumber!, t); }
        rows.set(a.orderId, {
          orderId: a.orderId, txHash: ev.transactionHash!, paidAt: t, campaignId: a.campaignId, merchant: a.merchant, creator: a.creator, buyer: a.buyer,
          gross: a.gross, merchantNet: a.merchantNet, commission: a.commission, fee: a.fee,
          refunded: 0n, commissionClawedBack: 0n, merchantPulled: 0n, commissionReleased: 0n, released: false, status: "held",
        });
      } else if (ev.eventName === "OrderRefunded") {
        const r = rows.get(ev.args.orderId);
        if (r) { r.refunded += ev.args.refundAmount; r.commissionClawedBack += ev.args.commissionClawback; r.merchantPulled += ev.args.merchantPulled; }
      } else if (ev.eventName === "CommissionReleased") {
        const r = rows.get(ev.args.orderId);
        if (r) { r.released = true; r.commissionReleased += ev.args.amount; }
      }
    }
  }
  for (const r of rows.values()) {
    // The protocol fee is never refunded, so a full refund is gross - fee (see NumaRouter.refund).
    r.status = r.refunded === 0n ? (r.released ? "released" : "held") : r.refunded >= r.gross - r.fee ? "refunded" : "partially_refunded";
  }
  return [...rows.values()].sort((a, b) => a.paidAt - b.paidAt || (a.orderId < b.orderId ? -1 : 1));
}

const usdt = (v: bigint) => formatUnits(v, 6);
export const CSV_HEADER = [
  "date_utc", "order_id", "tx_hash", "campaign_id", "buyer", "creator", "gross_usdt", "protocol_fee_usdt", "creator_commission_usdt",
  "merchant_net_usdt", "refunded_usdt", "merchant_refund_cost_usdt", "merchant_net_after_refunds_usdt", "commission_released_usdt", "status",
] as const;

/** Accountant-friendly CSV. Every field is a number, hex string or fixed word, so there is nothing to escape or inject. */
export function ledgerToCsv(rows: LedgerRow[]): string {
  const lines = rows.map((r) => [
    new Date(r.paidAt * 1000).toISOString(), r.orderId, r.txHash, r.campaignId.toString(), r.buyer, r.creator, usdt(r.gross), usdt(r.fee), usdt(r.commission),
    usdt(r.merchantNet), usdt(r.refunded), usdt(r.merchantPulled), usdt(r.merchantNet - r.merchantPulled), usdt(r.commissionReleased), r.status,
  ].join(","));
  return [CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

export const ledgerRowJson = (r: LedgerRow, explorerBase: string) => ({
  orderId: r.orderId, txHash: r.txHash, explorerUrl: `${explorerBase}/tx/${r.txHash}`, paidAt: new Date(r.paidAt * 1000).toISOString(), campaignId: r.campaignId.toString(),
  merchant: r.merchant, creator: r.creator, buyer: r.buyer, grossUsdt: usdt(r.gross), protocolFeeUsdt: usdt(r.fee), creatorCommissionUsdt: usdt(r.commission),
  merchantNetUsdt: usdt(r.merchantNet), refundedUsdt: usdt(r.refunded), merchantRefundCostUsdt: usdt(r.merchantPulled),
  merchantNetAfterRefundsUsdt: usdt(r.merchantNet - r.merchantPulled), commissionReleasedUsdt: usdt(r.commissionReleased), commissionReleased: r.released, status: r.status,
});

import type { PublicClient } from "viem";
import type { RelayStore } from "./store.js";

export interface ReconcileResult { settled: number; reverted: number; pending: number; stuck: number }

/**
 * Resolves relays whose outcome was never recorded (receipt timeout, crash after broadcast).
 * Source of truth is the chain: a successful receipt marks the order settled (and books the gas spend that
 * the original request never recorded); a reverted receipt marks it reverted, after which a NEW request may
 * resubmit; no receipt yet leaves it `sent` (reported as `stuck` once older than `stuckAfterMs`).
 */
export async function reconcileSent(
  store: RelayStore, pub: PublicClient,
  opts: { minAgeMs?: number; stuckAfterMs?: number; now?: () => number } = {},
  log: (o: object) => void = () => {},
): Promise<ReconcileResult> {
  const now = opts.now ?? Date.now;
  const out: ReconcileResult = { settled: 0, reverted: 0, pending: 0, stuck: 0 };
  for (const c of await store.listSent(opts.minAgeMs ?? 20_000)) {
    if (!c.txHash) continue;
    let receipt;
    try { receipt = await pub.getTransactionReceipt({ hash: c.txHash }); } catch { receipt = undefined; }
    if (!receipt) {
      const age = now() - (c.sentAtMs ?? now());
      if (age >= (opts.stuckAfterMs ?? 600_000)) { out.stuck++; log({ evt: "reconcile.stuck", orderId: c.orderId, txHash: c.txHash, ageMs: age }); } else out.pending++;
      continue;
    }
    if (receipt.status === "success") {
      const day = new Date(c.sentAtMs ?? now()).toISOString().slice(0, 10);
      await store.addSpend(day, receipt.gasUsed * receipt.effectiveGasPrice);
      await store.incrementAddress(day, c.buyer);
      await store.markSettled(c.orderId);
      out.settled++;
    } else {
      await store.markReverted(c.orderId);
      out.reverted++;
    }
    log({ evt: "reconcile.resolved", orderId: c.orderId, txHash: c.txHash, status: receipt.status });
  }
  return out;
}

import type { Hex } from "viem";

export interface ReleaseItem { orderId: Hex; paidAt: number; txHash: Hex | null; attempts: number }

export interface ReleaseQueue {
  /** Idempotent: re-adding an order (indexer replay) is a no-op. */
  add(orderId: Hex, paidAt: number): Promise<void>;
  /** Not-done items with paidAt <= beforeSec (i.e. settlement old enough to be past the refund window). */
  listDue(beforeSec: number, limit?: number): Promise<ReleaseItem[]>;
  markSent(orderId: Hex, txHash: Hex): Promise<void>;
  clearSent(orderId: Hex, error: string): Promise<void>;
  markFailed(orderId: Hex, error: string): Promise<void>;
  markDone(orderId: Hex): Promise<void>;
}

export class MemoryReleaseQueue implements ReleaseQueue {
  private items = new Map<string, ReleaseItem & { done: boolean; lastError?: string }>();
  async add(orderId: Hex, paidAt: number) { if (!this.items.has(orderId)) this.items.set(orderId, { orderId, paidAt, txHash: null, attempts: 0, done: false }); }
  async listDue(beforeSec: number, limit = 50) { return [...this.items.values()].filter((i) => !i.done && i.paidAt <= beforeSec).sort((a, b) => a.paidAt - b.paidAt).slice(0, limit).map(({ done: _d, lastError: _e, ...i }) => i); }
  async markSent(orderId: Hex, txHash: Hex) { const i = this.items.get(orderId); if (i) i.txHash = txHash; }
  async clearSent(orderId: Hex, error: string) { const i = this.items.get(orderId); if (i) { i.txHash = null; i.attempts++; i.lastError = error; } }
  async markFailed(orderId: Hex, error: string) { const i = this.items.get(orderId); if (i) { i.attempts++; i.lastError = error; } }
  async markDone(orderId: Hex) { const i = this.items.get(orderId); if (i) i.done = true; }
  all() { return [...this.items.values()]; }
}

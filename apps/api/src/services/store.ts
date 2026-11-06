import type { Hex } from "viem";

/** Operational state for the relayer. */
export interface RelayStore {
  /** Atomically claims an order. Returns false if already claimed (duplicate request). */
  claimOrder(orderId: Hex, buyer: string): Promise<boolean>;
  /** Frees a claim, only used when no transaction was sent. */
  releaseOrder(orderId: Hex): Promise<void>;
  markSent(orderId: Hex, txHash: Hex): Promise<void>;
  spentToday(day: string): Promise<bigint>;
  addSpend(day: string, wei: bigint): Promise<void>;
  countForAddress(day: string, address: string): Promise<number>;
  incrementAddress(day: string, address: string): Promise<void>;
}

export class MemoryRelayStore implements RelayStore {
  private claimed = new Set<string>();
  private spend = new Map<string, bigint>();
  private perAddr = new Map<string, number>();
  async claimOrder(id: Hex, _buyer?: string) { if (this.claimed.has(id)) return false; this.claimed.add(id); return true; }
  async releaseOrder(id: Hex) { this.claimed.delete(id); }
  async markSent() {}
  async spentToday(day: string) { return this.spend.get(day) ?? 0n; }
  async addSpend(day: string, wei: bigint) { this.spend.set(day, (this.spend.get(day) ?? 0n) + wei); }
  async countForAddress(day: string, a: string) { return this.perAddr.get(`${day}:${a.toLowerCase()}`) ?? 0; }
  async incrementAddress(day: string, a: string) { const k = `${day}:${a.toLowerCase()}`; this.perAddr.set(k, (this.perAddr.get(k) ?? 0) + 1); }
}

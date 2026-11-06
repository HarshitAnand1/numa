import type { Hex } from "viem";

/** Operational state for the relayer. In-memory for now; swap for Postgres (ops data only). */
export interface RelayStore {
  /** Returns false if orderId was already claimed (duplicate request). */
  claimOrder(orderId: Hex): boolean;
  releaseOrder(orderId: Hex): void;
  spentToday(day: string): bigint;
  addSpend(day: string, wei: bigint): void;
  countForAddress(day: string, address: string): number;
  incrementAddress(day: string, address: string): void;
}

export class MemoryRelayStore implements RelayStore {
  private claimed = new Set<string>();
  private spend = new Map<string, bigint>();
  private perAddr = new Map<string, number>();
  claimOrder(id: Hex) { if (this.claimed.has(id)) return false; this.claimed.add(id); return true; }
  releaseOrder(id: Hex) { this.claimed.delete(id); }
  spentToday(day: string) { return this.spend.get(day) ?? 0n; }
  addSpend(day: string, wei: bigint) { this.spend.set(day, this.spentToday(day) + wei); }
  countForAddress(day: string, a: string) { return this.perAddr.get(`${day}:${a.toLowerCase()}`) ?? 0; }
  incrementAddress(day: string, a: string) { const k = `${day}:${a.toLowerCase()}`; this.perAddr.set(k, (this.perAddr.get(k) ?? 0) + 1); }
}

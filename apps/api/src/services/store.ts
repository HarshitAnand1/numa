import type { Hex } from "viem";

/** claimed = reserved, nothing sent; sent = tx broadcast, outcome unknown; settled = receipt success; reverted = receipt reverted (order may be retried). */
export type ClaimStatus = "claimed" | "sent" | "settled" | "reverted";

export interface ClaimRecord { orderId: Hex; buyer: string; status: ClaimStatus; txHash: Hex | null; createdAtMs: number; sentAtMs: number | null }

/** Operational state for the relayer. */
export interface RelayStore {
  /** Atomically claims an order. Returns false if already claimed (duplicate request). A previously reverted order can be claimed again. */
  claimOrder(orderId: Hex, buyer: string): Promise<boolean>;
  /** Frees a claim, only used when no transaction was sent. */
  releaseOrder(orderId: Hex): Promise<void>;
  markSent(orderId: Hex, txHash: Hex): Promise<void>;
  markSettled(orderId: Hex): Promise<void>;
  markReverted(orderId: Hex): Promise<void>;
  getClaim(orderId: Hex): Promise<ClaimRecord | undefined>;
  /** Claims in `sent` state for longer than `olderThanMs` (candidates for reconciliation). */
  listSent(olderThanMs: number): Promise<ClaimRecord[]>;
  spentToday(day: string): Promise<bigint>;
  addSpend(day: string, wei: bigint): Promise<void>;
  countForAddress(day: string, address: string): Promise<number>;
  incrementAddress(day: string, address: string): Promise<void>;
}

export class MemoryRelayStore implements RelayStore {
  private claims = new Map<string, ClaimRecord>();
  private spend = new Map<string, bigint>();
  private perAddr = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  async claimOrder(id: Hex, buyer = "") {
    const prev = this.claims.get(id);
    if (prev && prev.status !== "reverted") return false;
    this.claims.set(id, { orderId: id, buyer: buyer.toLowerCase(), status: "claimed", txHash: null, createdAtMs: this.now(), sentAtMs: null });
    return true;
  }
  async releaseOrder(id: Hex) { const c = this.claims.get(id); if (c && !c.txHash) this.claims.delete(id); }
  async markSent(id: Hex, txHash: Hex) { const c = this.claims.get(id); if (c) { c.status = "sent"; c.txHash = txHash; c.sentAtMs = this.now(); } }
  async markSettled(id: Hex) { const c = this.claims.get(id); if (c) c.status = "settled"; }
  async markReverted(id: Hex) { const c = this.claims.get(id); if (c) c.status = "reverted"; }
  async getClaim(id: Hex) { const c = this.claims.get(id); return c && { ...c }; }
  async listSent(olderThanMs: number) { return [...this.claims.values()].filter((c) => c.status === "sent" && c.sentAtMs !== null && this.now() - c.sentAtMs >= olderThanMs).map((c) => ({ ...c })); }
  async spentToday(day: string) { return this.spend.get(day) ?? 0n; }
  async addSpend(day: string, wei: bigint) { this.spend.set(day, (this.spend.get(day) ?? 0n) + wei); }
  async countForAddress(day: string, a: string) { return this.perAddr.get(`${day}:${a.toLowerCase()}`) ?? 0; }
  async incrementAddress(day: string, a: string) { const k = `${day}:${a.toLowerCase()}`; this.perAddr.set(k, (this.perAddr.get(k) ?? 0) + 1); }
}

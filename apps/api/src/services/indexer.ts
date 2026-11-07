import { parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { numaRouterAbi } from "@numa/shared";

export type ConversionStatus = "held" | "released" | "refunded" | "partially_refunded";

/** Where conversions are published (Arkiv in production; faked in tests). */
export interface ConversionSink {
  get(orderId: Hex): Promise<{ gross: bigint } | undefined>;
  publish(c: { creator: Address; merchant: Address; campaignId: bigint; gross: bigint; commission: bigint; status: ConversionStatus; paidAt: number; txHash: Hex; orderId: Hex }): Promise<void>;
  setStatus(orderId: Hex, status: ConversionStatus): Promise<void>;
}
export interface CursorStore { get(): Promise<bigint>; set(block: bigint): Promise<void> }

/** Side effects run for every event, independent of Arkiv (e.g. queueing releases). Must be idempotent: ranges may be replayed. */
export interface IndexerHooks {
  settled?(e: { orderId: Hex; paidAt: number }): Promise<void>;
  released?(e: { orderId: Hex }): Promise<void>;
}

/** Used when Arkiv is not configured: the indexer still drives hooks (release keeper) but mirrors nothing. */
export const noopSink: ConversionSink = { get: async () => undefined, publish: async () => {}, setStatus: async () => {} };

export class MemoryCursor implements CursorStore {
  constructor(private block = 0n) {}
  async get() { return this.block; }
  async set(b: bigint) { this.block = b; }
}

/**
 * Reads router events and mirrors them to Arkiv. Idempotent by orderId: re-running a range does not
 * duplicate conversions. The chain stays the source of truth; Arkiv rows are a public mirror.
 */
export class Indexer {
  constructor(
    private readonly pub: PublicClient,
    private readonly router: Address,
    private readonly sink: ConversionSink,
    private readonly cursor: CursorStore,
    private readonly maxRange = 2_000n,
    private readonly confirmations = 1n,
    private readonly hooks: IndexerHooks = {},
  ) {}

  /** Process one batch; returns number of events handled. */
  async tick(log: (o: object) => void = () => {}): Promise<number> {
    const head = (await this.pub.getBlockNumber()) - this.confirmations;
    const from = (await this.cursor.get()) + 1n;
    if (head < from) return 0;
    const to = head < from + this.maxRange ? head : from + this.maxRange - 1n;

    const raw = await this.pub.getLogs({ address: this.router, fromBlock: from, toBlock: to });
    const events = parseEventLogs({ abi: numaRouterAbi, logs: raw });
    // Chain order: a release/refund must come after its settlement.
    events.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);

    let handled = 0;
    const tsCache = new Map<bigint, number>();
    for (const ev of events) {
      if (ev.eventName === "OrderSettled") {
        let ts = tsCache.get(ev.blockNumber!);
        if (ts === undefined) { ts = Number((await this.pub.getBlock({ blockNumber: ev.blockNumber! })).timestamp); tsCache.set(ev.blockNumber!, ts); }
        await this.hooks.settled?.({ orderId: ev.args.orderId, paidAt: ts });
        if (await this.sink.get(ev.args.orderId)) continue;
        const a = ev.args;
        await this.sink.publish({ creator: a.creator, merchant: a.merchant, campaignId: a.campaignId, gross: a.gross, commission: a.commission, status: "held", paidAt: ts, txHash: ev.transactionHash!, orderId: a.orderId });
        handled++;
      } else if (ev.eventName === "CommissionReleased") {
        await this.hooks.released?.({ orderId: ev.args.orderId });
        await this.sink.setStatus(ev.args.orderId, "released"); handled++;
      } else if (ev.eventName === "OrderRefunded") {
        const c = await this.sink.get(ev.args.orderId);
        if (!c) continue; // settlement not mirrored (yet); chain remains authoritative
        // The protocol fee is never refunded, so a full refund is gross - fee. Read the cumulative refunded amount from the
        // router (the authority); if that read fails, fall back to this event alone (a conservative "partially_refunded").
        let full = false;
        try {
          const s = await this.pub.readContract({ address: this.router, abi: numaRouterAbi, functionName: "getSettlement", args: [ev.args.orderId] });
          full = s.refundedGross >= s.gross - s.fee;
        } catch { full = false; }
        await this.sink.setStatus(ev.args.orderId, full ? "refunded" : "partially_refunded"); handled++;
      }
    }
    await this.cursor.set(to);
    log({ evt: "indexer.tick", from: from.toString(), to: to.toString(), handled });
    return handled;
  }
}

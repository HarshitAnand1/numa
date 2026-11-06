import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { numaRouterAbi } from "@numa/shared";
import type { ReleaseQueue } from "./releaseQueue.js";
import type { RelayStore } from "./store.js";

export interface KeeperConfig {
  router: Address;
  maxGasPriceWei: bigint;
  dailyCapWei: bigint;
  /** Give up on an order after this many failed attempts (it stays queued but is no longer retried automatically). */
  maxAttempts?: number;
  receiptTimeoutMs?: number;
}
export interface KeeperResult { released: number; skipped: number; failed: number; done: number }

/**
 * Calls `release(orderId)` once an order's refund window has passed (anyone may call it; the commission always goes to
 * the creator). Reads chain state before acting: already released or nothing held -> mark done without spending gas.
 * Uses CHAIN time (latest block timestamp), simulates before sending, shares the relayer's gas ceiling and daily cap,
 * and never resends while a release tx is still unresolved.
 */
export class ReleaseKeeper {
  constructor(
    private readonly cfg: KeeperConfig,
    private readonly pub: PublicClient,
    private readonly wallet: WalletClient,
    private readonly account: Account,
    private readonly queue: ReleaseQueue,
    private readonly store: RelayStore,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async tick(log: (o: object) => void = () => {}): Promise<KeeperResult> {
    const out: KeeperResult = { released: 0, skipped: 0, failed: 0, done: 0 };
    const window = await this.pub.readContract({ address: this.cfg.router, abi: numaRouterAbi, functionName: "refundWindow" });
    const chainNow = Number((await this.pub.getBlock({ blockTag: "latest" })).timestamp);
    const due = await this.queue.listDue(chainNow - Number(window));
    const maxAttempts = this.cfg.maxAttempts ?? 5;

    for (const item of due) {
      if (item.attempts >= maxAttempts) { out.skipped++; continue; }
      try {
        // A release tx we already sent: resolve it from its receipt, never send a second one on top.
        if (item.txHash) {
          let receipt;
          try { receipt = await this.pub.getTransactionReceipt({ hash: item.txHash }); } catch { receipt = undefined; }
          if (!receipt) { out.skipped++; continue; }
          if (receipt.status === "success") { await this.queue.markDone(item.orderId); out.done++; log({ evt: "keeper.confirmed", orderId: item.orderId, txHash: item.txHash }); }
          else { await this.queue.clearSent(item.orderId, "release tx reverted"); out.failed++; }
          continue;
        }

        const s = await this.pub.readContract({ address: this.cfg.router, abi: numaRouterAbi, functionName: "getSettlement", args: [item.orderId] });
        if (!s.exists || s.released || s.heldCommission === 0n) { await this.queue.markDone(item.orderId); out.done++; continue; }
        if (chainNow < Number(s.paidAt) + Number(window)) { out.skipped++; continue; }

        const gasPrice = await this.pub.getGasPrice();
        if (gasPrice > this.cfg.maxGasPriceWei) { out.skipped++; log({ evt: "keeper.gas_too_high", orderId: item.orderId }); continue; }
        const day = new Date(this.now() * 1000).toISOString().slice(0, 10);
        const args = [item.orderId] as const;
        let request;
        try { ({ request } = await this.pub.simulateContract({ address: this.cfg.router, abi: numaRouterAbi, functionName: "release", args, account: this.account })); }
        catch (e) { await this.queue.markFailed(item.orderId, e instanceof Error ? e.message.split("\n")[0]! : "simulation failed"); out.failed++; continue; }
        const gas = await this.pub.estimateContractGas({ address: this.cfg.router, abi: numaRouterAbi, functionName: "release", args, account: this.account });
        const maxCost = gas * gasPrice;
        if ((await this.store.spentToday(day)) + maxCost > this.cfg.dailyCapWei) { out.skipped++; log({ evt: "keeper.daily_cap", orderId: item.orderId }); continue; }
        if ((await this.pub.getBalance({ address: this.account.address })) < maxCost) { out.skipped++; log({ evt: "keeper.low_balance", orderId: item.orderId }); continue; }

        const txHash = await this.wallet.writeContract({ ...request, gas, gasPrice } as never);
        await this.queue.markSent(item.orderId, txHash);
        let receipt;
        try { receipt = await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: this.cfg.receiptTimeoutMs ?? 60_000 }); }
        catch { out.skipped++; log({ evt: "keeper.timeout", orderId: item.orderId, txHash }); continue; } // resolved on a later tick via the stored hash
        await this.store.addSpend(day, receipt.gasUsed * receipt.effectiveGasPrice);
        if (receipt.status === "success") { await this.queue.markDone(item.orderId); out.released++; log({ evt: "keeper.released", orderId: item.orderId, txHash }); }
        else { await this.queue.clearSent(item.orderId, "release tx reverted"); out.failed++; }
      } catch (e) {
        await this.queue.markFailed(item.orderId, e instanceof Error ? e.message.split("\n")[0]! : "error");
        out.failed++;
      }
    }
    return out;
  }
}
export type { Hex };

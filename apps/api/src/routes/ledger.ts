import type { FastifyInstance } from "fastify";
import { isAddress, isHex, type Address, type Hex, type PublicClient } from "viem";
import { numaRouterAbi, whitechainSepolia } from "@numa/shared";
import { LedgerRangeError, ledgerRowJson, ledgerToCsv, loadLedger } from "../services/ledger.js";
import type { RelayStore } from "../services/store.js";

export interface LedgerDeps {
  pub: PublicClient; router: Address; relayStore: RelayStore;
  /** First block to scan by default (the router's deployment block). */
  startBlock: bigint;
  explorerBase?: string;
}

/**
 * Merchant and customer views of settled payments, rebuilt from chain data (which is public, so these routes need no auth).
 *   GET /receipts/:orderId               a customer's receipt
 *   GET /merchants/:address/orders       the merchant's ledger; `?format=csv` for the accountant export
 */
export function registerLedgerRoutes(app: FastifyInstance, d: LedgerDeps) {
  const explorer = d.explorerBase ?? whitechainSepolia.blockExplorers.default.url;

  app.get("/receipts/:orderId", async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    if (!isHex(orderId, { strict: true }) || orderId.length !== 66) return reply.code(400).send({ error: "BAD_REQUEST", message: "orderId must be 0x + 64 hex" });
    const s = await d.pub.readContract({ address: d.router, abi: numaRouterAbi, functionName: "getSettlement", args: [orderId as Hex] });
    if (!s.exists) return reply.code(404).send({ error: "NOT_FOUND", message: "no settled order with this id" });
    const claim = await d.relayStore.getClaim(orderId as Hex); // tx hash is known if this relayer submitted it
    const txHash = claim?.txHash ?? null;
    const usdt = (v: bigint) => (Number(v) / 1e6).toFixed(6);
    const refundableBase = s.gross - s.fee;
    return {
      orderId, merchant: s.merchant, creator: s.creator, buyer: s.buyer, paidAt: new Date(Number(s.paidAt) * 1000).toISOString(),
      grossUsdt: usdt(s.gross), protocolFeeUsdt: usdt(s.fee), creatorCommissionUsdt: usdt(s.commission), merchantNetUsdt: usdt(s.gross - s.fee - s.commission),
      refundedUsdt: usdt(s.refundedGross), commissionStillHeldUsdt: usdt(s.heldCommission), commissionReleased: s.released,
      status: s.refundedGross === 0n ? (s.released ? "released" : "held") : s.refundedGross >= refundableBase ? "refunded" : "partially_refunded",
      txHash, explorerUrl: txHash ? `${explorer}/tx/${txHash}` : null,
    };
  });

  app.get("/merchants/:address/orders", async (req, reply) => {
    const { address } = req.params as { address: string };
    const q = req.query as { format?: string; fromBlock?: string; toBlock?: string };
    if (!isAddress(address)) return reply.code(400).send({ error: "BAD_REQUEST", message: "merchant address required" });
    const big = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? BigInt(v) : undefined);
    try {
      const rows = await loadLedger(d.pub, d.router, { merchant: address, fromBlock: big(q.fromBlock) ?? d.startBlock, ...(big(q.toBlock) !== undefined && { toBlock: big(q.toBlock)! }) });
      if (q.format === "csv") {
        return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="numa-orders-${address.toLowerCase()}.csv"`).send(ledgerToCsv(rows));
      }
      return { merchant: address, count: rows.length, orders: rows.map((r) => ledgerRowJson(r, explorer)) };
    } catch (e) {
      if (e instanceof LedgerRangeError) return reply.code(400).send({ error: "RANGE_TOO_LARGE", message: e.message });
      throw e;
    }
  });
}

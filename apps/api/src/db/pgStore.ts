import type { Hex } from "viem";
import type pg from "pg";
import type { RelayStore } from "../services/store.js";
import type { CursorStore } from "../services/indexer.js";

/** Postgres-backed relayer state: survives restarts, safe across multiple API instances. */
export class PgRelayStore implements RelayStore {
  constructor(private readonly pool: pg.Pool) {}

  async claimOrder(orderId: Hex, buyer: string) {
    const r = await this.pool.query("INSERT INTO relay_claims (order_id, buyer) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING", [orderId, buyer.toLowerCase()]);
    return r.rowCount === 1;
  }
  async releaseOrder(orderId: Hex) {
    // Never free a claim that already has a transaction attached.
    await this.pool.query("DELETE FROM relay_claims WHERE order_id = $1 AND tx_hash IS NULL", [orderId]);
  }
  async markSent(orderId: Hex, txHash: Hex) {
    await this.pool.query("UPDATE relay_claims SET tx_hash = $2 WHERE order_id = $1", [orderId, txHash]);
  }
  async spentToday(day: string) {
    const r = await this.pool.query("SELECT wei FROM relay_spend WHERE day = $1", [day]);
    return r.rows[0] ? BigInt(r.rows[0].wei) : 0n;
  }
  async addSpend(day: string, wei: bigint) {
    await this.pool.query("INSERT INTO relay_spend (day, wei) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET wei = relay_spend.wei + EXCLUDED.wei", [day, wei.toString()]);
  }
  async countForAddress(day: string, address: string) {
    const r = await this.pool.query("SELECT count FROM relay_address_counts WHERE day = $1 AND address = $2", [day, address.toLowerCase()]);
    return r.rows[0]?.count ?? 0;
  }
  async incrementAddress(day: string, address: string) {
    await this.pool.query("INSERT INTO relay_address_counts (day, address, count) VALUES ($1, $2, 1) ON CONFLICT (day, address) DO UPDATE SET count = relay_address_counts.count + 1", [day, address.toLowerCase()]);
  }
}

export class PgCursorStore implements CursorStore {
  constructor(private readonly pool: pg.Pool, private readonly id: string, private readonly initial: bigint) {}
  async get() {
    const r = await this.pool.query("SELECT block FROM indexer_cursor WHERE id = $1", [this.id]);
    return r.rows[0] ? BigInt(r.rows[0].block) : this.initial;
  }
  async set(block: bigint) {
    await this.pool.query("INSERT INTO indexer_cursor (id, block) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET block = EXCLUDED.block", [this.id, block.toString()]);
  }
}

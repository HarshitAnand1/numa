import type { Hex } from "viem";
import type pg from "pg";
import type { ClaimRecord, ClaimStatus, RelayStore } from "../services/store.js";
import type { CursorStore } from "../services/indexer.js";
import type { ClickStats, ClickStore } from "../services/clicks.js";
import type { ReleaseItem, ReleaseQueue } from "../services/releaseQueue.js";

/** Postgres-backed relayer state: survives restarts, safe across multiple API instances. */
export class PgRelayStore implements RelayStore {
  constructor(private readonly pool: pg.Pool) {}

  async claimOrder(orderId: Hex, buyer: string) {
    // A previously reverted order (receipt proved the tx failed) may be claimed again; anything else is a duplicate.
    const r = await this.pool.query(
      `INSERT INTO relay_claims (order_id, buyer) VALUES ($1, $2)
       ON CONFLICT (order_id) DO UPDATE SET status = 'claimed', tx_hash = NULL, sent_at = NULL, buyer = EXCLUDED.buyer, created_at = now()
       WHERE relay_claims.status = 'reverted'`,
      [orderId, buyer.toLowerCase()],
    );
    return r.rowCount === 1;
  }
  async releaseOrder(orderId: Hex) {
    // Never free a claim that already has a transaction attached.
    await this.pool.query("DELETE FROM relay_claims WHERE order_id = $1 AND tx_hash IS NULL", [orderId]);
  }
  async markSent(orderId: Hex, txHash: Hex) {
    await this.pool.query("UPDATE relay_claims SET tx_hash = $2, status = 'sent', sent_at = now() WHERE order_id = $1", [orderId, txHash]);
  }
  async markSettled(orderId: Hex) { await this.pool.query("UPDATE relay_claims SET status = 'settled' WHERE order_id = $1", [orderId]); }
  async markReverted(orderId: Hex) { await this.pool.query("UPDATE relay_claims SET status = 'reverted' WHERE order_id = $1", [orderId]); }

  private static row(r: { order_id: string; buyer: string; status: string; tx_hash: string | null; created_ms: string; sent_ms: string | null }): ClaimRecord {
    return { orderId: r.order_id as Hex, buyer: r.buyer, status: r.status as ClaimStatus, txHash: r.tx_hash as Hex | null, createdAtMs: Number(r.created_ms), sentAtMs: r.sent_ms === null ? null : Number(r.sent_ms) };
  }
  private static cols = "order_id, buyer, status, tx_hash, (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS created_ms, (EXTRACT(EPOCH FROM sent_at)*1000)::bigint AS sent_ms";
  async getClaim(orderId: Hex) {
    const r = await this.pool.query(`SELECT ${PgRelayStore.cols} FROM relay_claims WHERE order_id = $1`, [orderId]);
    return r.rows[0] ? PgRelayStore.row(r.rows[0]) : undefined;
  }
  async listSent(olderThanMs: number) {
    const r = await this.pool.query(`SELECT ${PgRelayStore.cols} FROM relay_claims WHERE status = 'sent' AND sent_at <= now() - ($1::bigint * interval '1 millisecond') ORDER BY sent_at LIMIT 200`, [olderThanMs]);
    return r.rows.map(PgRelayStore.row);
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

export class PgClickStore implements ClickStore {
  constructor(private readonly pool: pg.Pool) {}
  async record(code: string, visitor: string) {
    await this.pool.query("INSERT INTO link_clicks (code, visitor) VALUES ($1, $2)", [code, visitor]);
  }
  async stats(code: string): Promise<ClickStats> {
    const r = await this.pool.query("SELECT count(*)::int AS clicks, count(DISTINCT visitor)::int AS unique_visitors FROM link_clicks WHERE code = $1", [code]);
    return { clicks: r.rows[0].clicks, uniqueVisitors: r.rows[0].unique_visitors };
  }
}

export class PgReleaseQueue implements ReleaseQueue {
  constructor(private readonly pool: pg.Pool) {}
  async add(orderId: Hex, paidAt: number) {
    await this.pool.query("INSERT INTO release_queue (order_id, paid_at) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING", [orderId, paidAt]);
  }
  async listDue(beforeSec: number, limit = 50): Promise<ReleaseItem[]> {
    const r = await this.pool.query("SELECT order_id, paid_at, tx_hash, attempts FROM release_queue WHERE done = false AND paid_at <= $1 ORDER BY paid_at LIMIT $2", [beforeSec, limit]);
    return r.rows.map((x) => ({ orderId: x.order_id as Hex, paidAt: Number(x.paid_at), txHash: x.tx_hash as Hex | null, attempts: x.attempts }));
  }
  async markSent(orderId: Hex, txHash: Hex) { await this.pool.query("UPDATE release_queue SET tx_hash = $2 WHERE order_id = $1", [orderId, txHash]); }
  async clearSent(orderId: Hex, error: string) { await this.pool.query("UPDATE release_queue SET tx_hash = NULL, attempts = attempts + 1, last_error = $2 WHERE order_id = $1", [orderId, error.slice(0, 300)]); }
  async markFailed(orderId: Hex, error: string) { await this.pool.query("UPDATE release_queue SET attempts = attempts + 1, last_error = $2 WHERE order_id = $1", [orderId, error.slice(0, 300)]); }
  async markDone(orderId: Hex) { await this.pool.query("UPDATE release_queue SET done = true, tx_hash = NULL WHERE order_id = $1", [orderId]); }
}

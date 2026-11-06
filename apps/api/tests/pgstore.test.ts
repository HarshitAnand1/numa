import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { PgCursorStore, PgRelayStore } from "../src/db/pgStore.js";

// Integration test: runs only when TEST_DATABASE_URL points at a disposable Postgres.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("Postgres stores", () => {
  let pool: pg.Pool;
  const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
  const run = Date.now();

  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await migrate(pool); });
  afterAll(async () => { await pool.end(); });

  it("migrations are idempotent", async () => {
    expect(await migrate(pool)).toEqual([]);
  });
  it("claims an order exactly once, even concurrently", async () => {
    const s = new PgRelayStore(pool);
    const results = await Promise.all(Array.from({ length: 10 }, () => s.claimOrder(id(run), "0xAbC")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("release frees an unsent claim but never one with a tx", async () => {
    const s = new PgRelayStore(pool);
    expect(await s.claimOrder(id(run + 1), "0xa")).toBe(true);
    await s.releaseOrder(id(run + 1));
    expect(await s.claimOrder(id(run + 1), "0xa")).toBe(true);
    await s.markSent(id(run + 1), id(99));
    await s.releaseOrder(id(run + 1));
    expect(await s.claimOrder(id(run + 1), "0xa")).toBe(false);
  });
  it("accumulates spend and per-address counts (case-insensitive address)", async () => {
    const s = new PgRelayStore(pool);
    const day = `t-${run}`;
    await s.addSpend(day, 10n ** 30n);
    await s.addSpend(day, 5n);
    expect(await s.spentToday(day)).toBe(10n ** 30n + 5n);
    await s.incrementAddress(day, "0xABC");
    await s.incrementAddress(day, "0xabc");
    expect(await s.countForAddress(day, "0xAbC")).toBe(2);
    expect(await s.spentToday("none")).toBe(0n);
  });
  it("persists the indexer cursor", async () => {
    const c = new PgCursorStore(pool, `cur-${run}`, 41n);
    expect(await c.get()).toBe(41n);
    await c.set(1234567n);
    expect(await new PgCursorStore(pool, `cur-${run}`, 0n).get()).toBe(1234567n);
  });
});

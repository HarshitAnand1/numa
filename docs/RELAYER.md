# Relayer

Implemented in `apps/api/src/services/relayer.ts`. Fixed target: only `payOrder` on the configured `NUMA_ROUTER_ADDRESS`; requests cannot choose a contract or calldata.

Checks in order: order deadline, auth window, buyer≠creator, merchant sig well-formed, duplicate claim, per-address daily limit, gas price ceiling, **simulation**, gas estimate vs daily cap, relayer balance, send, wait for receipt and require `status=success`. After a tx is sent the order claim is kept (no automatic retry); on timeout check the explorer before retrying.

State (order claims, daily spend, per-address counts) is in Postgres when `DATABASE_URL` is set (`PgRelayStore`; atomic claim via `INSERT … ON CONFLICT DO NOTHING`, so concurrent duplicates can't both pass; a claim with a tx hash is never released). Without `DATABASE_URL` it falls back to `MemoryRelayStore` (lost on restart; dev only). A restart mid-flight leaves the claim in place with `tx_hash` set — check the explorer before retrying that order. Rate limiting via `@fastify/rate-limit`.
**Funding:** the relayer key (`RELAYER_PRIVATE_KEY`) must hold WBT from the Whitechain faucet; `/health` exposes its balance. Not yet validated against a live router or a zero-WBT buyer.

# Relayer

Implemented in `apps/api/src/services/relayer.ts`. Fixed target: only `payOrder` on the configured `NUMA_ROUTER_ADDRESS`; requests cannot choose a contract or calldata.

Checks in order: order deadline, auth window, buyer≠creator, merchant sig well-formed, **buyer's EIP-3009 authorization verified locally** (typed data rebuilt with `to=router`, `value=order.amount` and a nonce derived from the order digest + creator — never taken from the request — and the recovered signer must equal `buyer`; wrong amount/nonce/window/signer → `BAD_BUYER_AUTH` before any RPC call), duplicate claim, per-address daily limit, gas price ceiling, **simulation**, gas estimate vs daily cap, relayer balance, send, wait for receipt and require `status=success`. After a tx is sent the order claim is kept (no automatic retry); on timeout check the explorer before retrying.

State (order claims, daily spend, per-address counts) is in Postgres when `DATABASE_URL` is set (`PgRelayStore`; atomic claim via `INSERT … ON CONFLICT DO NOTHING`, so concurrent duplicates can't both pass; a claim with a tx hash is never released). Without `DATABASE_URL` it falls back to `MemoryRelayStore` (lost on restart; dev only). A restart mid-flight leaves the claim in place with `tx_hash` set — check the explorer before retrying that order. Rate limiting via `@fastify/rate-limit`.
**Funding:** the relayer key (`RELAYER_PRIVATE_KEY`) must hold WBT from the Whitechain faucet; `/health` exposes its balance. Not yet validated against a live router or a zero-WBT buyer.

## Relay outcomes and reconciliation
Each claim has a status: `claimed` (reserved, nothing sent) → `sent` (broadcast, outcome unknown) → `settled` (receipt success) or `reverted` (receipt reverted). `GET /relay/:orderId` returns it (+ explorer link) for frontend polling.
- A **reverted** receipt proves the order did not settle, so a *new* request may resubmit it (no automatic retry).
- A **timeout** leaves the claim `sent`. A background reconciler (every 15 s) looks up the tx receipt from chain: success → `settled` and books the gas spend and per-address count the original request never recorded; reverted → `reverted`; no receipt yet → stays `sent`, logged as `stuck` after 10 min. It never guesses and never resubmits.
- Migration `002_claim_status.sql` adds the columns.

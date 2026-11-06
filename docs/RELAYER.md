# Relayer

Implemented in `apps/api/src/services/relayer.ts`. Fixed target: only `payOrder` on the configured `NUMA_ROUTER_ADDRESS`; requests cannot choose a contract or calldata.

Checks in order: order deadline, auth window, buyer≠creator, merchant sig well-formed, **buyer's EIP-3009 authorization verified locally** (typed data rebuilt with `to=router`, `value=order.gross` and a nonce recomputed locally as the `OrderCommitment` from the order plus the campaign's on-chain `commissionBps` and the router's `feeBps` — never taken from the request — and the recovered signer must equal `buyer`; wrong amount/nonce/window/signer → `BAD_BUYER_AUTH` before any send; see ADR 0005), duplicate claim, per-address daily limit, gas price ceiling, **simulation**, gas estimate vs daily cap, relayer balance, send, wait for receipt and require `status=success`. After a tx is sent the order claim is kept (no automatic retry); on timeout check the explorer before retrying.

State (order claims, daily spend, per-address counts) is in Postgres when `DATABASE_URL` is set (`PgRelayStore`; atomic claim via `INSERT … ON CONFLICT DO NOTHING`, so concurrent duplicates can't both pass; a claim with a tx hash is never released). Without `DATABASE_URL` it falls back to `MemoryRelayStore` (lost on restart; dev only). A restart mid-flight leaves the claim in place with `tx_hash` set — check the explorer before retrying that order. Rate limiting via `@fastify/rate-limit`.
**Funding:** the relayer key (`RELAYER_PRIVATE_KEY`) must hold WBT from the Whitechain faucet; `/health` exposes its balance. **Not yet validated against a deployed router or a zero-WBT buyer.**

## Relay outcomes and reconciliation
Each claim has a status: `claimed` (reserved, nothing sent) → `sent` (broadcast, outcome unknown) → `settled` (receipt success) or `reverted` (receipt reverted). `GET /relay/:orderId` returns it (+ explorer link) for frontend polling.
- A **reverted** receipt proves the order did not settle, so a *new* request may resubmit it (no automatic retry).
- A **timeout** leaves the claim `sent`. A background reconciler (every 15 s) looks up the tx receipt from chain: success → `settled` and books the gas spend and per-address count the original request never recorded; reverted → `reverted`; no receipt yet → stays `sent`, logged as `stuck` after 10 min. It never guesses and never resubmits.
- Migration `002_claim_status.sql` adds the columns.

## Release keeper (`services/keeper.ts`)
`NumaRouter.release(orderId)` is callable by anyone once `refundWindow` has passed and always pays the creator, so the backend runs a keeper that makes "commission released" happen without a human. The indexer queues every `OrderSettled` (table `release_queue`, migration 004; idempotent on replay) and marks orders done on `CommissionReleased`; the keeper (every `KEEPER_POLL_MS`, default 30 s):
1. computes due orders from **chain time** (latest block timestamp) and the router's `refundWindow()`, then re-reads `getSettlement` — if already released / unknown / nothing held (e.g. fully refunded) it marks the order done without spending gas;
2. checks the relayer's gas-price ceiling, daily gas cap and WBT balance (shared with relaying — releases count against the same cap), simulates `release`, then sends;
3. stores the tx hash; a receipt timeout is resolved from the receipt on a later tick and **never** produces a second release; a reverted release clears the hash and counts an attempt; after 5 failed attempts the order stays queued but is no longer retried automatically.
The indexer now runs even without an Arkiv writer key (it just mirrors nothing), so the keeper works in a minimal deployment. Uses the relayer wallet, so it needs WBT.

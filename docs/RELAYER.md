# Relayer

Implemented in `apps/api/src/services/relayer.ts`. Fixed target: only `payOrder` on the configured `NUMA_ROUTER_ADDRESS`; requests cannot choose a contract or calldata.

Checks in order: order deadline, auth window, buyer≠creator, merchant sig well-formed, duplicate claim, per-address daily limit, gas price ceiling, **simulation**, gas estimate vs daily cap, relayer balance, send, wait for receipt and require `status=success`. After a tx is sent the order claim is kept (no automatic retry); on timeout check the explorer before retrying.

Limits are in-memory (`MemoryRelayStore`) — reset on restart; move to Postgres before real use. Rate limiting via `@fastify/rate-limit`.
**Funding:** the relayer key (`RELAYER_PRIVATE_KEY`) must hold WBT from the Whitechain faucet; `/health` exposes its balance. Not yet validated against a live router or a zero-WBT buyer.

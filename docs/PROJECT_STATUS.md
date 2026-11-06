# Project Status (single source of truth)

| Phase | Status |
|---|---|
| 0 Repo audit | Done (`REPOSITORY_AUDIT.md`) |
| 1 Research | Partial: Whitechain/USDT EIP-3009 and Arkiv SDK researched (`docs/ARKIV.md`). Refund funding model: TODO |
| 2 Foundation | Partial: monorepo skeleton, Foundry + OpenZeppelin, compose, env. No app scaffolds, CI, lint yet |
| 3 Contracts | Not started |
| 4 Arkiv + backend | Partial (branch `feat/backend-relayer`, uncommitted): shared protocol types, order signing service, relayer with guards, API server, 17 unit tests passing with mocked chain clients. `packages/arkiv` implemented against SDK 1.0.1 (schemas, publish/query, owner checks; offline tests only, no live write yet). Indexer, reputation, Postgres: TODO |
| 5 Frontend | Not started |
| 6 SDK + demo shop | Not started |
| 7 E2E | Not started |

Nothing is deployed. Gasless checkout is NOT yet demonstrated.

## Open decisions
- Refund funding model (merchant net is paid instantly; refund needs merchant-approved USDT pull or escrow of refundable portion). Needs ADR.
- Project name: **numa** (renamed from "Outcome" by the user; brief text still says Outcome — contract is `NumaRouter`).

## Interface proposal awaiting Member 1
`packages/shared/src/order.ts` and `abi.ts` define a PROPOSED `Order{campaignId,orderId,creator,amount,deadline}` (EIP-712 domain `NumaRouter`/`1`), auth nonce `keccak256(abi.encode(digest, creator))`, and `payOrder(order, merchantSig, buyer, validAfter, validBefore, v, r, s)`. The backend has never run against a real router; contracts must match or this changes.

## Documentation
Written: DESIGN, ARCHITECTURE (Mermaid), SMART_CONTRACTS (design only), ARKIV, WHITECHAIN, RELAYER, API, SECURITY, SDK (target design), DEVELOPMENT, DEMO (plan), DECISIONS 0001 (refund model, **Proposed**), 0002, 0003. Docs for unbuilt parts are labeled as plans.

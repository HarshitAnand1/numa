# Project Status (single source of truth)

| Phase | Status |
|---|---|
| 0 Repo audit | Done (`REPOSITORY_AUDIT.md`) |
| 1 Research | Partial: Whitechain/USDT EIP-3009 verified, refund funding model resolved (`DECISIONS/0001-refund-funding-model.md`), Arkiv SDK researched (`docs/ARKIV.md`). |
| 2 Foundation | Partial: monorepo skeleton, Foundry + OpenZeppelin, compose, env, `packages/shared` ABI/types export and typechecked/tested package tooling (viem, zod, vitest). No app scaffolds, CI, lint, or root tsconfig yet. |
| 3 Contracts | **Done** (local): `CampaignRegistry.sol` + `NumaRouter.sol` implemented, 41/41 Foundry tests passing (unit + fuzz, incl. 512-run payout-split invariant). **Not deployed to Whitechain Sepolia yet** — needs a human with a funded keystore (owner: Member 1). See `docs/SMART_CONTRACTS.md`. **Not yet integrated with the backend/relayer — see "Interface reconciliation" below; this is a known, unresolved gap, not a completed integration.** |
| 4 Arkiv + backend | Partial (branch `feat/backend-relayer`): shared protocol types, order signing service, relayer with guards, API server, 17 unit tests passing with mocked chain clients. `packages/arkiv` implemented against SDK 1.0.1 (schemas, publish/query, owner checks; offline tests only, no live write yet). Conversion verifier, reputation scoring, event indexer (Arkiv sink), `/creators/:addr/reputation` built and unit-tested against synthetic ABI-encoded logs (34 tests total). **Never run against a real router or live Arkiv.** Postgres store (SQL migrations, relayer claims/spend/limits, indexer cursor) built and integration-tested against a real Postgres; server smoke-tested booting with throwaway keys. Order sessions table not built. 30 tests (5 Postgres tests need `TEST_DATABASE_URL`). **Built against a pre-implementation Order/ABI proposal that does not match the contracts actually shipped in Phase 3 — see "Interface reconciliation" below.** |
| 5 Frontend | Not started |
| 6 SDK + demo shop | Not started |
| 7 E2E | Not started |

Nothing is deployed. Gasless checkout is NOT yet demonstrated.

## Contracts handoff (Member 1 → Member 2 / Member 3, per `TEAM.md`)
- ABIs: `packages/shared/src/abis/{CampaignRegistry,NumaRouter}.json` (regenerate after any contract change: `pnpm contracts:build` then re-export, see `docs/SMART_CONTRACTS.md`).
- Order struct + EIP-712 typed-data definition for signing: `packages/shared/src/contracts-types.ts`, re-exported from `@numa/shared` as `NumaRouterOrder` (renamed at the barrel export to avoid colliding with the pre-existing, differently-shaped `Order` type in `packages/shared/src/order.ts` — see "Interface reconciliation" below).
- Events to index: `OrderSettled`, `OrderRefunded`, `CommissionReleased` (NumaRouter); `CampaignCreated`, `CreatorApproved`, `CreatorRevoked`, `CampaignPaused` (CampaignRegistry).
- Deployed addresses: `packages/shared/src/addresses.ts` — currently empty, populate after the first testnet deploy.
- Integration requirement for merchants (frontend/SDK, Member 3): merchants must `USDT.approve(NumaRouter, ...)` to fund refunds — see the ADR.

## Interface reconciliation — OPEN, blocking backend↔contracts integration

Member 2's backend (`packages/shared/src/order.ts`, `abi.ts`, `schemas.ts`; `packages/sdk-server/src/{signer,numa}.ts`; `apps/api/src/services/{relayer,verify}.ts`) was built against a **pre-implementation proposal** for the `Order` shape and `NumaRouter` ABI, explicitly self-labeled as such ("PROPOSED interface — must be agreed with Member 1 (contracts) before the router is final"). It has never been run against a real router. The actually-implemented and shipped contracts (checkpoint `6c2cccf8885a8bef330774cc34c475bc3e11b660`) differ in several concrete, breaking ways:

1. **`Order` struct shape.** Proposed: `{campaignId, orderId, creator, amount, deadline}` (5 fields, no `merchant`, no `buyer`). Shipped: `{campaignId, merchant, creator, buyer, gross, orderId, deadline}` (7 fields). The shipped contract has the merchant *sign* who the expected buyer is as part of the order; the proposed design does not pin the buyer in the signed struct at all (`buyer` is a separate, unsigned relayer parameter in the proposal) — this is a trust-model difference, not just a naming one (`amount` vs `gross`).
2. **`payOrder` calldata.** The proposed ABI (`packages/shared/src/abi.ts`) has no explicit `authNonce` parameter: `payOrder(order, merchantSig, buyer, validAfter, validBefore, v, r, s)`. The shipped contract requires the caller to pass `authNonce` explicitly: `payOrder(order, merchantSignature, validAfter, validBefore, authNonce, v, r, s)`. The relayer (`apps/api/src/services/relayer.ts`) currently computes a nonce locally (`deriveAuthNonce`) only to verify the buyer's EIP-3009 signature off-chain — it never passes that nonce into the on-chain call, because the proposed ABI has nowhere to put it.
3. **`CampaignRegistry` read interface.** `packages/shared/src/abi.ts`'s `campaignRegistryAbi` declares `merchantOf(uint256) view returns (address)`. The shipped `CampaignRegistry.sol` has no such function — the equivalent data is `getCampaign(campaignId).merchant` (a field on the `Campaign` struct returned by `getCampaign`).
4. **`OrderSettled` event ABI.** The proposed ABI indexes `creator` as the third indexed topic; the shipped event indexes `merchant` as the third indexed topic (`orderId`, `campaignId`, `merchant` are indexed; `creator`, `buyer`, `gross`, `merchantNet`, `commission`, `fee` are not). Code that decodes this event by indexed-topic position (not just by field name) will decode it incorrectly against the real contract.

**Resolution ownership**: per the project's own architecture (money lives only on-chain; the contracts are the settlement source of truth) and since the contracts side is implemented, tested (41/41), and already checkpointed/pushed, the correct direction is to **adapt the backend/shared proposal to match the shipped contracts**, not the reverse. This requires changes to Member 2-owned files (`order.ts`, `abi.ts`, `schemas.ts`, `signer.ts`, `numa.ts`, `relayer.ts`, `verify.ts`) and has **not been done** as part of this merge — those files were left untouched to avoid Member 1 unilaterally rewriting Member 2's workstream. Needs a direct Member 1 ↔ Member 2 sync before the relayer can be run against a real deployed router.

## Open decisions
- Project name: **numa** (renamed from "Outcome" by the user; brief text still says Outcome — contract is `NumaRouter`).

## Blockers
- Whitechain testnet deployment needs a human-funded Foundry keystore (WBT for gas) — the agent's shell has no TTY for keystore signing. Owner: Member 1. See `docs/SMART_CONTRACTS.md` → Deployment.
- `pnpm contracts:build` / `pnpm contracts:test` (the root package.json scripts) currently fail in this environment with a corepack signature-verification error on `pnpm@10.34.9` (network/registry issue, unrelated to the contracts code). Verified directly with `forge build` / `forge test -vv` instead — both pass (41/41 tests). Whoever has a working `pnpm` locally should confirm the root scripts also work end-to-end.
- Backend↔contracts interface reconciliation (see above) — blocks running the relayer against a real router.

## Documentation
Written: DESIGN, ARCHITECTURE (Mermaid), SMART_CONTRACTS (now reflects the actual implemented contracts, not just design — see `docs/SMART_CONTRACTS.md`), ARKIV, WHITECHAIN, RELAYER, API, SECURITY, SDK (target design), DEVELOPMENT, DEMO (plan), DECISIONS 0001 (refund model, **Accepted** — matches the implemented contracts), 0002, 0003. Docs for unbuilt parts are labeled as plans.

## SDK
`@numa/sdk-server` (`Numa`, `OrderSigner`) built and unit-tested (5 tests); API uses it. Built against the pre-implementation Order/ABI proposal — see "Interface reconciliation" above. `@numa/sdk-react` and `apps/demo-shop`: not started (Member 3).

## Creator discovery layer (Member 2)
Built and tested offline (43 API + 20 Arkiv tests): `numa.profile`, `numa.invite`, `numa.endorsement`; creator search, trending, recommendations, leaderboard, creator card, invite verification; endorsement and conversion verification against `OrderSettled`. **Not verified live:** no Arkiv write/read round trip yet; `CampaignRegistry.merchantOf` doesn't exist on the shipped contract (see "Interface reconciliation" above — use `getCampaign(campaignId).merchant` instead). Frontend for these: not started (Member 3).

## Arkiv live readiness (Member 2)
Rabdi-safe writer built (5 tests). Three dev wallets generated locally into `.env` (writer / test merchant / test creator; addresses only in `live:check` output). `live:check --check` confirmed Rabdi chain 7794095 and 1 gwei gas; **wallets hold 0 tGLM, so no live write has happened.** Blocker: fund the writer address (~0.022 tGLM) at hub.arkiv.network/faucet and set `ARKIV_ACCESS_KEY` (hub.arkiv.network/access-keys).

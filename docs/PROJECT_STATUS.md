# Project Status (single source of truth)

| Phase | Status |
|---|---|
| 0 Repo audit | Done (`REPOSITORY_AUDIT.md`) |
| 1 Research | Partial: Whitechain/USDT EIP-3009 verified, refund funding model resolved (`DECISIONS/0001-refund-funding-model.md`), Arkiv SDK researched (`docs/ARKIV.md`). |
| 2 Foundation | Partial: monorepo skeleton, Foundry + OpenZeppelin, compose, env, `packages/shared` ABI/types export and typechecked/tested package tooling (viem, zod, vitest). No app scaffolds, CI, lint, or root tsconfig yet. |
| 3 Contracts | **Done** (local): `CampaignRegistry.sol` + `NumaRouter.sol` implemented, 49/49 Foundry tests passing (unit + fuzz, incl. two 512-run invariants). Includes the `OrderCommitment` EIP-3009 nonce-binding fix from the mentor security review (`docs/DECISIONS/0005-order-commitment-nonce-binding.md`) — buyer authorizations are now cryptographically bound to the full order+split, closing an order/creator/campaign-substitution gap. **Not deployed to Whitechain Sepolia yet** — needs a human with a funded keystore (owner: Member 1). See `docs/SMART_CONTRACTS.md`. **Interface now reconciled with the backend (see "Interface reconciliation" below) and verified via unit/mocked tests — NOT yet exercised end-to-end against a live deployed router.** |
| 4 Arkiv + backend | Partial (branch `feat/backend-relayer`): shared protocol types, order signing service, relayer with guards, API server. `packages/arkiv` implemented against SDK 1.0.1 (schemas, publish/query, owner checks, Rabdi-safe writer; `live:check` passed 7/7 against a real Rabdi testnet). Conversion verifier, reputation scoring, event indexer (Arkiv sink), `/creators/:addr/reputation` built and unit-tested against synthetic ABI-encoded logs. **Never run against a real router.** Postgres store (SQL migrations, relayer claims/spend/limits, indexer cursor) built and integration-tested against a real Postgres previously; order sessions table not built. **Interface reconciled as of this update** (Order shape, `authNonce`/`OrderCommitment`, `getCampaign` instead of `merchantOf`, `OrderSettled` indexing) — see "Interface reconciliation" below. `apps/api` 40/45 tests passing (5 Postgres-dependent tests skipped, no `TEST_DATABASE_URL` available this run); `packages/sdk-server` 5/5; `packages/shared` 1/1; `packages/arkiv` 25/25. |
| 5 Frontend | Partial (branch `feat/frontend`): `apps/web` Vite SPA. **Public screens (home trending, campaigns, creator card, leaderboard) read `apps/api` discovery endpoints** through a typed client, with a visibly labelled DEMO DATA fallback when the API is unreachable. Creator/merchant dashboards, checkout, verify and demo shop are still **mock data only**. No wallet, no chain writes. 18 unit tests. See ADR 0005. |
| 6 SDK + demo shop | Not started |
| 7 E2E | Not started |

Nothing is deployed. Gasless checkout is NOT yet demonstrated.

## Contracts handoff (Member 1 → Member 2 / Member 3, per `TEAM.md`)
- ABIs: `packages/shared/src/abis/{CampaignRegistry,NumaRouter}.json` (regenerate after any contract change: `pnpm contracts:build` then re-export, see `docs/SMART_CONTRACTS.md`).
- Order struct + EIP-712 typed-data definition for signing: `packages/shared/src/contracts-types.ts`, re-exported from `@numa/shared` as `NumaRouterOrder` (renamed at the barrel export to avoid colliding with the pre-existing, differently-shaped `Order` type in `packages/shared/src/order.ts` — see "Interface reconciliation" below).
- **New**: `OrderCommitment` type, `ORDER_COMMITMENT_EIP712_TYPES`, and a fixed cross-language test vector (`ORDER_COMMITMENT_TEST_VECTOR*`) — all in `packages/shared/src/contracts-types.ts`, re-exported from `@numa/shared`. Member 2 needs this to compute the buyer's EIP-3009 `nonce` correctly; see "Interface reconciliation" below and `docs/DECISIONS/0005-order-commitment-nonce-binding.md`.
- Events to index: `OrderSettled`, `OrderRefunded`, `CommissionReleased` (NumaRouter); `CampaignCreated`, `CreatorApproved`, `CreatorRevoked`, `CampaignPaused` (CampaignRegistry).
- Deployed addresses: `packages/shared/src/addresses.ts` — currently empty, populate after the first testnet deploy.
- Integration requirement for merchants (frontend/SDK, Member 3): merchants must `USDT.approve(NumaRouter, ...)` to fund refunds — see the ADR.

## Interface reconciliation — RESOLVED in code and tests; NOT yet verified live

The four gaps below (Order shape, `payOrder`/`authNonce` calldata, `merchantOf`, `OrderSettled` indexing) have been fixed in `packages/shared/src/{order,abi,schemas}.ts`, `packages/sdk-server/src/{signer,numa}.ts`, and `apps/api/src/{services/relayer,routes/discovery,server}.ts`, and are covered by updated/new unit tests (`packages/sdk-server` 5/5, `apps/api` 40/45 — see Blockers for the 5 skipped). **This is unit/mocked-chain verification only — the full path (real buyer wallet → real relayer → real deployed `NumaRouter` → real `OrderSettled` event) has never been exercised, since nothing is deployed yet (see Phase 3 above and `docs/SMART_CONTRACTS.md` → Deployment).** Do not read this as a completed integration until that live run happens.

What changed, for reference against the prior (now-fixed) proposal:

1. **`Order` struct shape.** Was: `{campaignId, orderId, creator, amount, deadline}` (5 fields, no `merchant`/`buyer`). Now matches the shipped contract exactly: `{campaignId, merchant, creator, buyer, gross, orderId, deadline}` (7 fields) — the merchant signs who the expected buyer is, closing the trust-model gap, not just a naming fix.
2. **`payOrder` calldata / `authNonce`.** `payOrder` now passes `authNonce` explicitly, computed via `computeOrderCommitment` — an exact TypeScript mirror of `NumaRouter.sol`'s `ORDER_COMMITMENT_TYPEHASH` (9 fields, `uint96` for `commissionBps`/`feeBps`), replacing the old, incompatible `deriveAuthNonce` formula. The relayer (`apps/api/src/services/relayer.ts`) independently fetches `commissionBps` (`CampaignRegistry.getCampaign`) and `feeBps` (`NumaRouter.feeBps`) and recomputes the commitment itself — it never trusts a caller-supplied nonce, preserving the "reject bad requests locally before spending gas" property the relayer already had.
3. **`CampaignRegistry` read interface.** `campaignRegistryAbi` now exposes `getCampaign`/`isCreatorApproved`/`isSettleable` matching the real contract; the nonexistent `merchantOf` is gone. `discovery.ts`'s `merchantOf()` helper reads `getCampaign(...).merchant`.
4. **`OrderSettled` event ABI.** Now indexes `merchant` (not `creator`) as the third topic, matching the real event; `OrderRefunded` gained the previously-missing `merchantPulled` field. `indexer.ts` and `verify.ts` needed no changes — both already decoded fields by name, not topic position.

See the commit `fix(shared,sdk-server,api): reconcile backend interface with shipped contracts` for the complete file-by-file rationale, including the `Numa`/`OrderSigner` API changes needed to supply `merchant`/`commissionBps`/`feeBps` (multi-campaign-capable, read once per campaign from on-chain state, never hardcoded) and the `createOrderRequest`/`relayRequest` schema updates.

## Open decisions
- Project name: **numa** (renamed from "Outcome" by the user; brief text still says Outcome — contract is `NumaRouter`).

## Blockers
- Whitechain testnet deployment needs a human-funded Foundry keystore (WBT for gas) — the agent's shell has no TTY for keystore signing. Owner: Member 1. See `docs/SMART_CONTRACTS.md` → Deployment.
- `pnpm contracts:build` / `pnpm contracts:test` (the root package.json scripts) currently fail in this environment with a corepack signature-verification error on `pnpm@10.34.9` (network/registry issue, unrelated to the contracts code). Verified directly with `forge build` / `forge test -vv` instead — both pass (49/49 tests). Whoever has a working `pnpm` locally should confirm the root scripts also work end-to-end.
- Live end-to-end verification (real buyer → relayer → deployed router → event decode) — blocked on the Whitechain testnet deployment above, not on the interface itself (now reconciled, see above).
- `apps/api`'s 5 Postgres-dependent tests (`tests/pgstore.test.ts`) are skipped without `TEST_DATABASE_URL`. A Postgres instance happened to be listening on `:5432` in one verification run, but it was a different, unrelated instance (`numa`/`numa` credentials failed authentication against it) — Docker Desktop was not running, so the project's own `docker-compose` Postgres was never started. Run `docker compose up -d postgres` and set `TEST_DATABASE_URL` to exercise these.

## Documentation
Written: DESIGN, ARCHITECTURE (Mermaid), SMART_CONTRACTS (now reflects the actual implemented contracts, not just design — see `docs/SMART_CONTRACTS.md`), ARKIV, WHITECHAIN, RELAYER, API, SECURITY, SDK (target design), DEVELOPMENT, DEMO (plan), DECISIONS 0001 (refund model, **Accepted** — matches the implemented contracts), 0002, 0003, 0004 (superseded refund-model draft, preserved for history), 0005 (`OrderCommitment` EIP-3009 nonce binding, **Accepted** — mentor security review fix). Docs for unbuilt parts are labeled as plans.

## SDK
`@numa/sdk-server` (`Numa`, `OrderSigner`) built and unit-tested (5 tests); API uses it. Updated to the reconciled interface (see "Interface reconciliation" above) — `merchant`/`commissionBps`/`feeBps` are now required inputs, read from on-chain campaign/router state, never hardcoded. `@numa/sdk-react` and `apps/demo-shop`: not started (Member 3).

## Creator discovery layer (Member 2)
Built and tested offline: `numa.profile`, `numa.invite`, `numa.endorsement`; creator search, trending, recommendations, leaderboard, creator card, invite verification; endorsement and conversion verification against `OrderSettled`. **Not verified live:** no Arkiv write/read round trip against this specific layer yet (Arkiv's own `live:check` passed separately, see below); `discovery.ts` now correctly reads `getCampaign(campaignId).merchant` (fixed, see "Interface reconciliation" above). Frontend for these: screens exist with mock data, not yet wired (Member 3).

## Arkiv live readiness (Member 2)
Rabdi-safe writer built (5 tests). Three dev wallets generated locally into `.env` (writer / test merchant / test creator; addresses only in `live:check` output). `live:check --check` confirmed Rabdi chain 7794095 and 1 gwei gas; **Update 2026-11-06: funded and run — `live:check` passed 7/7 on Rabdi** (see `ARKIV.md` → Verified). The writer is the team's own funded Arkiv account; the two test wallets are throwaway.

## Frontend (Member 3)
`apps/web` was generated from Figma (`docs/FIGMA_PROMPT.md`) and revised: non-overlapping hero, larger `numa` wordmark, warmer palette, CSS/JS animation (no animation library; respects `prefers-reduced-motion`), self-hosted fonts.

**Wired to the API (`src/api/`):** typed client for `/discovery/{campaigns,trending,leaderboard}` and `/creators/:address`; `useResource` hook; `DataBadge` shows LIVE / DEMO DATA / SYNCING on every such screen. Rule: demo fixtures appear **only** when the API is unreachable, times out (6s), or returns an HTTP error (or `VITE_DATA_MODE=demo`); a successful empty response is shown as an honest empty state. `merchantVerified: null` is rendered as "unchecked", never "verified"; `score: null` as "No verified sales history yet". Dev: Vite proxies `/api` to `VITE_API_PROXY` (default `http://localhost:8787`).
Verified against the **real** `apps/api` booted locally with throwaway keys: `/discovery/*` returned `[]` and `/creators/:address` returned a no-profile, null-score card, and the UI rendered both correctly. A populated response was verified only against a stand-in server shaped from `routes/discovery.ts`, **not** real Arkiv data (none exists yet, and querying Arkiv without a free access key is heavily rate-limited: the first discovery query hung for ~60s before later ones returned in ~1s).

**Still mock:** creator and merchant dashboards, checkout (the "settle" is a timer), verify, demo shop, campaign detail. **Not built:** wallet connect, `receiveAuthTypedData` signing, `/orders` + `/relay` calls, on-chain and Arkiv writes, merchant `USDT.approve(NumaRouter)` step (ADR 0001), `@numa/sdk-react`, `apps/demo-shop`, real URL routing.
**Backend note for Member 2:** `apps/api` sends no CORS headers (fine in dev via the Vite proxy; a deployed web app on another origin will need CORS or a same-origin proxy), and discovery queries have no server-side timeout.
Gasless checkout is still NOT demonstrated.
## Backend foundation additions (Member 2)
Done and tested locally: relay-outcome tracking + chain reconciler (`GET /relay/:orderId`), attribution-link click tracker + stats + `demo:fake-clicks` script (ran 500 clicks against a live local server), automatic release keeper (queue + chain-time checks + no double sends), Arkiv live checks for sorting/pagination (9/9 on Rabdi), API Dockerfile (built, run, healthy), ESLint (clean), CI workflow (YAML-validated only, not yet run on GitHub). 70 API tests + 26 arkiv + 5 sdk-server + 2 shared. **Still unverified live:** the keeper, reconciler and click stats have never run against a deployed router; they depend on the Whitechain deployment.

## Backend update (Member 2): CORS, discovery timeout, demo seed
- `CORS_ORIGINS` (comma-separated allowlist, `*` allowed; empty = no CORS headers). Preflight answered with 204. Tested.
- `DISCOVERY_TIMEOUT_MS` (default 15000): `/discovery/*` and `/creators/*` return 504 `UPSTREAM_TIMEOUT` instead of hanging when Arkiv stalls. Tested with a never-resolving fake.
- `pnpm --filter @numa/arkiv seed:demo [-- --yes]`: dry run by default. Seeded Rabdi with 4 campaigns (ids 7001-7004), 4 creator profiles and 4 offers, all prefixed `[DEMO]`. Idempotent. These campaign ids do not exist on-chain, so they show as not merchant-verified, and there are no conversions or scores: no sale is faked.
- Repo hygiene found after merging the frontend: `pnpm-lock.yaml` on `main` had a duplicated key (broke `--frozen-lockfile`, so CI); regenerated. ESLint: removed a reference to an unregistered react-hooks rule and downgraded unused-vars to warnings under `apps/web/src` (not-yet-routed screens). Two ADRs are numbered 0005 (web SPA vs OrderCommitment): one needs renumbering.

# Project status (single source of truth)

_Last reviewed: 2026-11-07. Everything marked "verified" was run; everything else is a claim about code, not about a live system._

**Rehearsed on a fork (2026-11-07):** the full flow, with the real test USDT proxy, passes 11/11 on a local fork of Whitechain Sepolia: real checkout code, a buyer with zero WBT, the real relayer, indexer and keeper, exact balances, duplicate and forged-request rejection, automatic release, partial refund with clawback, receipt and CSV export. This is **not** a live deployment: no real chain state, no real wallet, no Arkiv mirroring, no explorer verification (`DEVELOPMENT.md`).

**Bottom line:** the contracts, relayer, indexer, keeper, Arkiv layer and discovery API are built and tested. **Nothing is deployed to Whitechain Sepolia, and a real gasless checkout has never been demonstrated.** The frontend's public screens read live API data; its checkout, dashboards and demo shop are still mock.

| Phase | Status |
|---|---|
| 0 Repo audit | Done (`REPOSITORY_AUDIT.md`, a dated snapshot) |
| 1 Research | Done: Whitechain USDT supports EIP-3009 (`WHITECHAIN.md`), refund model decided (ADR 0001), Arkiv SDK researched (`ARKIV.md`) |
| 2 Foundation | Done: pnpm monorepo, Foundry + OpenZeppelin, Docker Compose, ESLint, GitHub Actions CI (typecheck, lint, tests with Postgres, forge build/test; passing on `main`), `.env.example` |
| 3 Contracts | Built, **not deployed**. `CampaignRegistry` + `NumaRouter`, 55 Foundry tests (unit, fuzz, invariants), `OrderCommitment` nonce binding (ADR 0005), pre-deployment hardening (ADR 0006). A deploy script and checklist exist (`DEPLOYMENT_CHECKLIST.md`). Owner: Member 1 |
| 4 Arkiv + backend | Built and tested; **never run against a deployed router**. Relayer with guards, reconciler, release keeper, indexer, click tracker, discovery + reputation API, negotiation agents (below), Dockerfile, Postgres store. Arkiv live checks pass on Rabdi (`live:check` 9/9, `live:agents` 4/4, `live:browser` 3/3) |
| 5 Frontend | Partial. Public screens (home, campaigns, campaign detail, creator card, leaderboard) read the API with an honest DEMO DATA fallback. Checkout, dashboards, verify and demo shop are mock. No wallet, no chain writes |
| 6 SDK + demo shop | `@numa/sdk-server` and `@numa/sdk-react` (gasless EIP-3009 checkout component) built and unit-tested with a fake wallet; `apps/demo-shop` built (a store page that adds the checkout in about 20 lines). **None of it has run against a deployed router or a real wallet** |
| 7 End-to-end | Not started (blocked on deployment) |

## Test counts (2026-11-07, local and CI)
Foundry 55 · `packages/sdk-react` 11 · `apps/api` 103 (+8 Postgres integration tests that run in CI and are skipped locally without `TEST_DATABASE_URL`) · `packages/arkiv` 26 · `apps/web` 28 · `packages/sdk-server` 6 · `packages/shared` 6.

## Blockers
1. **Deployment** of `CampaignRegistry` and `NumaRouter` to Whitechain Sepolia needs a human with a funded Foundry keystore (Member 1). Then fill `packages/shared/src/addresses.ts` and `.env`.
2. **Relayer wallet** needs WBT (it pays gas for `payOrder` and `release`).
3. **Live end-to-end run** (zero-WBT buyer → relayer → router → indexer → Arkiv conversion → reputation) can only happen after 1 and 2.
4. **Frontend wiring** (Member 3): wallet connect, EIP-3009 signing, `/orders` + `/relay` calls, merchant `USDT.approve(NumaRouter)` for refunds (ADR 0001), Arkiv writes from the browser wallet.

## Not verified (do not claim these)
- Any path through a **really deployed** `NumaRouter` or `CampaignRegistry`. The relay, keeper and release path is verified on a fork only; still unverified anywhere: the reconciler against a stalled tx, click-stats verification, `merchantVerified`, the agent runner against the registry.
- Gasless `receiveWithAuthorization` on the **real** chain. On a fork of it, against the real USDT proxy, it works (the rehearsal); the real-chain transfer is not done.
- Arkiv entity expiry actually firing, full 100-row pages, large payloads. Browser-wallet writes are verified only through a stand-in injected wallet, **not** a real extension (`ARKIV.md` → Browser wallets).
- The Claude note path of the agents against the real API (tests use a fake client).
- The Docker `app` compose profile (config-validated only; the API image itself was built and its `/health` checked).

## Contracts handoff (Member 1 → 2 / 3)
- ABIs: `packages/shared/src/abis/{CampaignRegistry,NumaRouter}.json` (regenerate after any contract change; see `SMART_CONTRACTS.md`). The checked-in `NumaRouter.json` may lag the compiled ABI by the new `MAX_REFUND_WINDOW` constant, which nothing uses.
- Order struct and typed data: `packages/shared/src/contracts-types.ts` (exported as `NumaRouterOrder`; `Order` in `order.ts` is the backend's own view). `OrderCommitment` type, EIP-712 types and a cross-language test vector live there too; the TypeScript digest equals the Solidity one (tested).
- Events to index: `OrderSettled`, `OrderRefunded`, `CommissionReleased` (router); `CampaignCreated`, `CreatorApproved`, `CreatorRevoked`, `CampaignPaused` (registry).
- Deployed addresses: `packages/shared/src/addresses.ts` (empty until the first deploy).
- Merchants must `USDT.approve(NumaRouter, …)` to fund refunds (ADR 0001).
- **Commission is per campaign.** `createCampaign(payoutSigner, commissionBps, endsAt)` is immutable; `approveCreator(campaignId, creator)` only whitelists a creator and carries no rate.

## Backend interface reconciliation (resolved in code and tests, not live)
The backend's pre-contract proposal differed from what Member 1 shipped. Fixed in `packages/shared`, `packages/sdk-server` and `apps/api`: (1) the `Order` struct is now `{campaignId, merchant, creator, buyer, gross, orderId, deadline}`; (2) `payOrder` passes an explicit `authNonce` computed as `OrderCommitment` (the relayer recomputes it from on-chain `commissionBps` and `feeBps` and never trusts a supplied nonce); (3) the registry is read through `getCampaign(id)` (there is no `merchantOf`); (4) the `OrderSettled` ABI indexes `merchant` and `OrderRefunded` has `merchantPulled`.

## Backend features (Member 2)
- **Relayer:** fixed target, local verification of the buyer's authorization, simulate-first, gas ceiling, daily cap, per-address limit; claim statuses `claimed → sent → settled | reverted`; reconciler resolves timeouts from the chain (`RELAYER.md`).
- **Release keeper:** queues every settlement and calls `release` after the refund window using chain time, never double-sending (`RELAYER.md`).
- **Indexer + Arkiv:** mirrors `OrderSettled` into `numa.conversion`, idempotent by `orderId`; reputation counts only conversions verified against the event (`API.md`).
- **Click tracker:** `/r/:code` counts clicks (hashed visitor) and `demo:fake-clicks` shows 500 clicks next to 0 verified sales (`DEMO.md`).
- **Discovery:** campaigns, trending, creator search, leaderboard, creator card, recommendations, invites (`API.md`, `ARKIV.md`). Seeded with `[DEMO]` data on Rabdi via `seed:demo`; those campaign ids do not exist on-chain and show as unverified.
- **Receipts and export:** `GET /receipts/:orderId` and `GET /merchants/:address/orders` (JSON or accountant CSV), rebuilt from chain events; checked against on-chain balances in the rehearsal.
- **Deploy tooling:** fork rehearsal and a read-only preflight (`DEVELOPMENT.md`).
- **Operational:** CORS allowlist (`CORS_ORIGINS`), discovery timeout (504 after `DISCOVERY_TIMEOUT_MS`), Postgres migrations (001-005), Dockerfile.
- **Negotiation agents** (`AGENTS.md`, ADR 0008, **Proposed**): `numa.agent` and `numa.negotiation` entities, rules engine with private guardrails, signed policy API, verified threads, deal tickets, runner loop (off unless `AGENT_WALLET_PRIVATE_KEY` is set), optional Claude phrasing. Feed and status endpoints for the UI (`/agents/threads`, `/agents/binding`) and the shared signed-text builder (`@numa/shared`) are built. Not built: any UI, a live run against a registry.

## Open decisions
- **Merchant signing model.** `POST /orders` signs with a server-held `MERCHANT_SIGNER_KEY` (demo). Real merchants sign in their own backend with `@numa/sdk-server`; a hosted flow needs the merchant's own signature or a registered `payoutSigner`.
- **Agents in the pitch.** ADR 0008 is Proposed and needs team review.
- **Claude co-author trailers in git history.** Old commits on `main` carry `Co-Authored-By: Claude`. The team agreed to clean this up last; it needs a history rewrite and everyone to re-sync, so it must happen before the repo is made public.
- **ADR numbers:** 0001-0008 (0004 is a superseded draft).

## Frontend (Member 3)
`apps/web` was generated from Figma (`docs/FIGMA_PROMPT.md`) and revised: non-overlapping hero, larger `numa` wordmark, warmer palette, CSS/JS animation (no animation library; respects `prefers-reduced-motion`), self-hosted fonts.

**Wired to the API (`src/api/`):** typed client for `/discovery/{campaigns,trending,leaderboard}` and `/creators/:address`; `useResource` hook; `DataBadge` shows LIVE / DEMO DATA / SYNCING on every such screen. Rule: demo fixtures appear **only** when the API is unreachable, times out (6s), or returns an HTTP error (or `VITE_DATA_MODE=demo`); a successful empty response is shown as an honest empty state. `merchantVerified: null` is rendered as "unchecked", never "verified"; `score: null` as "No verified sales history yet". Dev: Vite proxies `/api` to `VITE_API_PROXY` (default `http://localhost:8787`).
Verified against the **real** `apps/api` booted locally with throwaway keys: `/discovery/*` returned `[]` and `/creators/:address` returned a no-profile, null-score card, and the UI rendered both correctly. A populated response was verified only against a stand-in server shaped from `routes/discovery.ts`, **not** real Arkiv data (none exists yet, and querying Arkiv without a free access key is heavily rate-limited: the first discovery query hung for ~60s before later ones returned in ~1s).

**Routing:** `src/routes.ts` maps URLs to screens (`/campaigns/:id`, `/creators/:address`, 404 for anything malformed). A static host must serve `index.html` for unknown paths (SPA fallback); Vite dev/preview already do. **Campaign detail** (`/campaigns/:id`) was never reachable or styled in the Figma export (blank page); it now loads the campaign from the API and its offer flow ends in an explicit "NOT PUBLISHED, preview only" state, since wallet signing and Arkiv writes are not built.
**Still mock:** creator and merchant dashboards, checkout (the "settle" is a timer), verify, demo shop. **Not built:** wallet connect, `receiveAuthTypedData` signing, `/orders` + `/relay` calls, on-chain and Arkiv writes, merchant `USDT.approve(NumaRouter)` step (ADR 0001), `@numa/sdk-react`, `apps/demo-shop`.
**Backend note (resolved):** the CORS allowlist and server-side discovery timeout I asked Member 2 for have landed (see "Backend update" below). For a deployed web app set `CORS_ORIGINS` on the API and `VITE_API_URL` on the web build; in dev the Vite proxy still avoids CORS.
Gasless checkout is still NOT demonstrated.

## Documentation
Index in `docs/README.md`. Docs describing unbuilt parts are labelled as plans.

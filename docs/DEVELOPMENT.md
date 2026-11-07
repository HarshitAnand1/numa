# Development
Requirements: Node ≥ 22, pnpm 10, Foundry, Docker. The repo vendors OpenZeppelin as plain files under `packages/contracts/lib` (no git submodules).
```
pnpm install
cp .env.example .env        # fill locally; never commit
docker compose up -d postgres
pnpm contracts:build && pnpm contracts:test
pnpm typecheck && pnpm test
pnpm --filter @numa/api dev  # needs a full .env (router address, relayer key…)
```
Deploys need a Foundry keystore (`cast wallet import <name> --interactive`) run by a human; see `.agents/skills/whitechain-dev/`. Arkiv writes need tGLM (faucet: hub.arkiv.network/faucet); Whitechain gas needs WBT.
Workstream branches: `feat/contracts` (Member 1), `feat/backend-relayer` and short-lived `feat/*` / `docs/*` branches (Member 2), `feat/frontend` (Member 3). Work lands on `main` through pull requests; CI must pass.

## Useful scripts
| Command | What |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | all TypeScript packages (lint excludes contracts; use `forge fmt` there) |
| `pnpm contracts:build` / `pnpm contracts:test` | Foundry build and tests |
| `pnpm --filter @numa/web dev` | frontend dev server (proxies `/api` to `VITE_API_PROXY`, default `http://localhost:8787`) |
| `pnpm --filter @numa/api rehearsal` | local end-to-end rehearsal on a **fork** of Whitechain Sepolia (see below) |
| `pnpm --filter @numa/api preflight [-- --campaign N]` | read-only deploy-day checks against the chain in `.env` |
| `pnpm --filter @numa/demo-shop dev` | the demo store (adds the checkout component), on :5174 |
| `pnpm --filter @numa/api dev` | API with watch; needs a full `.env` |
| `pnpm --filter @numa/api demo:fake-clicks -- --code X --n 500 --creator 0x.. --campaign N` | send real HTTP clicks to the click tracker (see `DEMO.md`) |
| `pnpm --filter @numa/arkiv query:example` | read-only: live campaigns, open creators and offers on Rabdi (no key needed) |
| `pnpm --filter @numa/arkiv seed:demo [-- --yes]` | publish `[DEMO]` marketplace data to Rabdi (dry run without `--yes`) |
| `pnpm --filter @numa/arkiv live:check [-- --check]` | live Arkiv round trip for every entity type, then cleanup |
| `pnpm --filter @numa/arkiv live:agents` | live round trip for the negotiation-agent entities, then cleanup |
| `pnpm --filter @numa/arkiv live:browser` | live writes through a stand-in injected wallet (the browser write path), then cleanup |

The `live:*` and `seed:*` scripts read keys from `.env` (`ARKIV_WRITER_PRIVATE_KEY`, `ARKIV_TEST_MERCHANT_KEY`, `ARKIV_TEST_CREATOR_KEY`, `ARKIV_ACCESS_KEY`) and spend a few thousandths of tGLM.

## Optional features (all off unless configured)
- `CORS_ORIGINS`, `DISCOVERY_TIMEOUT_MS`: browser access and discovery timeout.
- `ARKIV_WRITER_PRIVATE_KEY`: enables discovery routes and conversion mirroring.
- `AGENT_WALLET_PRIVATE_KEY` (+ optionally `GEMINI_API_KEY`/`GEMINI_MODEL` (free tier) or `ANTHROPIC_API_KEY`/`AGENT_LLM_MODEL`, and `AGENT_LLM_PROVIDER`): enables negotiation agents and LLM-phrased notes. `pnpm --filter @numa/api llm:check` tests the key.
See `.env.example` for every variable.

## Database
`docker compose up -d postgres`, set `DATABASE_URL` (see `.env.example`). The API applies `apps/api/src/db/migrations/*.sql` on startup (tracked in `schema_migrations`, advisory-locked). Integration tests: create a throwaway DB and run `TEST_DATABASE_URL=postgres://numa:numa@localhost:5432/numa_test pnpm --filter @numa/api test` (skipped when unset). Postgres holds operational data only; money state is on-chain and marketplace state is in Arkiv.

## Docker, lint, CI
- **API image:** `docker build -f docker/api.Dockerfile -t numa-api .` (non-root user, `/health` healthcheck, ~590 MB; runs the TypeScript sources with tsx). Full stack: fill `.env` then `docker compose --profile app up --build` (Postgres + API; the API gets `DATABASE_URL` pointing at the compose Postgres). Build and `/health` were verified locally; the compose `app` profile itself was config-validated only.
- **Lint:** `pnpm lint` (ESLint 9 + typescript-eslint recommended; contracts are excluded — use `forge fmt`). Currently clean.
- **CI:** `.github/workflows/ci.yml` runs typecheck, lint and tests (with a Postgres service, so the Postgres integration tests run) plus `forge build` / `forge test`. It runs on every pull request and passes on `main`. CI installs with `--frozen-lockfile`, so commit `pnpm-lock.yaml` whenever dependencies change.

## Rehearsal on a fork (before any real deployment)
`pnpm --filter @numa/api rehearsal` needs `forge build` output and `anvil`. It forks Whitechain Sepolia (so the **real** test USDT proxy and its EIP-3009 are used), deploys `CampaignRegistry` and `NumaRouter` to the fork, creates a campaign, mints test USDT by impersonating the token owner (fork only), starts the real API (relayer, indexer, keeper) and runs the real checkout code with a wallet that holds **zero WBT**. It asserts exact on-chain balances for: a gasless settlement, duplicate rejection, a forged request, automatic commission release, a partial refund with proportional clawback, an underfunded buyer, the preflight, and the receipt and CSV export. It touches neither the real chain nor Arkiv, needs the public RPC for forking (override with `REHEARSAL_FORK_URL`), and takes about a minute. It is not in CI because it depends on the live RPC.

What it does not prove: the real chain under load, real wallets, Arkiv mirroring (noop sink here), the faucet, or the verified-on-explorer step.

## Preflight
`pnpm --filter @numa/api preflight` (optionally `-- --campaign 1`) is read-only and sends no transaction. It checks: RPC reachable and on the expected chain, router and registry have code, the router is wired to this registry and the **real** test USDT, fee and refund window, the USDT `DOMAIN_SEPARATOR` equals what the checkout signs, the relayer wallet has WBT and the network gas price is under the ceiling, the demo merchant signer is the campaign's payout signer, plus warnings for missing Postgres, CORS and the Arkiv key. Exit code 1 on any failure.

# Development
Requirements: Node ≥22, pnpm 10, Foundry, Docker.
```
pnpm install
cp .env.example .env        # fill locally; never commit
docker compose up -d postgres
pnpm contracts:build && pnpm contracts:test
pnpm typecheck && pnpm test
pnpm --filter @numa/api dev  # needs a full .env (router address, relayer key…)
```
Deploys need a Foundry keystore (`cast wallet import <name> --interactive`) run by a human; see `.agents/skills/whitechain-dev/`. Arkiv writes need tGLM (faucet: hub.arkiv.network/faucet); Whitechain gas needs WBT.
Branches: `main`, `feat/contracts`, `feat/backend-relayer`, `feat/arkiv`, `feat/frontend`, `feat/sdk`.

## Database
`docker compose up -d postgres`, set `DATABASE_URL` (see `.env.example`). The API applies `apps/api/src/db/migrations/*.sql` on startup (tracked in `schema_migrations`, advisory-locked). Integration tests: create a throwaway DB and run `TEST_DATABASE_URL=postgres://numa:numa@localhost:5432/numa_test pnpm --filter @numa/api test` (skipped when unset). Postgres holds operational data only; money state is on-chain and marketplace state is in Arkiv.

## Docker, lint, CI
- **API image:** `docker build -f docker/api.Dockerfile -t numa-api .` (non-root user, `/health` healthcheck, ~590 MB; runs the TypeScript sources with tsx). Full stack: fill `.env` then `docker compose --profile app up --build` (Postgres + API; the API gets `DATABASE_URL` pointing at the compose Postgres). Build and `/health` were verified locally; the compose `app` profile itself was config-validated only.
- **Lint:** `pnpm lint` (ESLint 9 + typescript-eslint recommended; contracts are excluded — use `forge fmt`). Currently clean.
- **CI:** `.github/workflows/ci.yml` runs typecheck, lint and tests (with a Postgres service, so the integration tests run) plus `forge build` / `forge test`. **Not yet executed on GitHub** — it has only been YAML-validated; check the first PR run.

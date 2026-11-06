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

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

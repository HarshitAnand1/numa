# numa

Pay creators only when a real sale settles. Fake clicks earn $0.

Numa is a drop-in USDT checkout and creator marketplace on Whitechain Sepolia. A buyer's gasless (EIP-3009) USDT payment settles through `NumaRouter`: merchant net paid, creator commission held through a refund window, protocol fee collected. Campaigns, offers, decisions, links and conversions are wallet-owned Arkiv entities.

> **Status:** early setup. See `docs/PROJECT_STATUS.md`. Nothing is deployed; gasless checkout is not yet demonstrated.

## Layout
`apps/{web,api,demo-shop}`, `packages/{contracts,shared,arkiv,sdk-server,sdk-react,config}`, `docs/`. Team: `TEAM.md`. Full brief: `initial-prompt.md`.

## Quick start
```
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm contracts:build
```
Docs: `docs/WHITECHAIN.md`, `docs/PROJECT_STATUS.md`. More docs (DESIGN, ARCHITECTURE, ARKIV, …) are pending.

## Arkiv (hackathon track: Build on Arkiv)
Marketplace data lives in wallet-owned Arkiv entities on Rabdi (chain 7794095). Submission files: [`arkiv/schema.md`](arkiv/schema.md) (entities, indexes, owners, expiry), [`arkiv/how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md), [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md), [`arkiv/reach.md`](arkiv/reach.md), [`arkiv/friction.md`](arkiv/friction.md).
- **Writer wallets:** numa writer `0x53FFc438d1389087e0159F024C2C85cC08eA32B3`; demo merchant and creator wallets are listed in `arkiv/schema.md`.
- **A query you can run** (read-only, no key needed): `pnpm install && pnpm --filter @numa/arkiv query:example` lists live campaigns sorted by commission, open creators and live offers, with each entity's owner wallet. Seed more demo data with `pnpm --filter @numa/arkiv seed:demo -- --yes`. Verify the SDK round trip with `pnpm --filter @numa/arkiv live:check`.
- Discovery screens in `apps/web` read these entities through `apps/api` (`/discovery/*`).

## How we used AI
AI coding assistance (Claude Code) helped write and review code and docs in this repository, under the direction of the three human team members, who reviewed and are responsible for all commits. AI is a tool here, not a contributor (see `TEAM.md`). Architecture, protocol decisions and the claims in `docs/PROJECT_STATUS.md` were checked against tests and live runs, and anything unverified is labelled as such.

## License
MIT, see `LICENSE`.

## Known limitations
Self-purchases via alternate wallets, sybils, merchant collusion, relayer availability and gas funding are not solved; reputation does not prove audience authenticity.

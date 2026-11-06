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

## Known limitations
Self-purchases via alternate wallets, sybils, merchant collusion, relayer availability and gas funding are not solved; reputation does not prove audience authenticity.

# numa

**Pay creators only when a real sale settles. Fake clicks earn $0.**

numa is a drop-in USDT checkout and creator marketplace on Whitechain Sepolia. A buyer's gasless (EIP-3009) USDT payment settles through `NumaRouter`: the merchant's net is paid, the creator's commission is held through a refund window, and a protocol fee is collected. Discovery, offers, decisions, links, conversion history, profiles, invites and endorsements are wallet-owned [Arkiv](https://docs.arkiv.network) entities that anyone can query.

> **Status (2026-11-07):** contracts, relayer, indexer, Arkiv layer and discovery API are built and tested. **Nothing is deployed yet and a real gasless checkout has not been demonstrated.** The frontend's public screens read live data; its checkout is still a mock. Details and the exact list of what is and isn't verified: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## How it works
1. A **merchant** creates a campaign (commission rate, end date, payout signer) on `CampaignRegistry` and publishes it to Arkiv.
2. A **creator** publishes a profile and an offer, gets approved, and shares an attribution link.
3. A **buyer** opens the link, signs a USDT `receiveWithAuthorization` (no gas, no WBT needed). The merchant has signed the order; the relayer submits `payOrder`.
4. `NumaRouter` splits the payment atomically. After the refund window anyone (our keeper) calls `release` to pay the creator.
5. The indexer mirrors each settled sale into a `numa.conversion` entity. A creator's reputation counts **only** conversions that match an on-chain `OrderSettled` event.

Optional negotiation agents can haggle the commission over Arkiv on each party's behalf, inside private limits ([`docs/AGENTS.md`](docs/AGENTS.md)).

There is no Stripe, no oracle, no verifier signature and no campaign escrow: proof of conversion is the settled payment itself.

## Repository layout
| Path | What |
|---|---|
| `packages/contracts` | `CampaignRegistry`, `NumaRouter` (Foundry, OpenZeppelin) |
| `packages/shared` | chain config, ABIs, order and `OrderCommitment` types (shared by everything) |
| `packages/arkiv` | Arkiv schemas, safe writer, publish/query functions, live checks and demo seeding |
| `packages/sdk-server` | merchant-side order signing (`Numa`, `OrderSigner`) |
| `apps/api` | relayer, reconciler, release keeper, indexer, discovery + reputation API, click tracker, negotiation agents |
| `apps/web` | Vite + React app (public screens wired to the API; its own checkout screen is still mock; real checkout is `sdk-react`) |
| `packages/sdk-react` | `<NumaCheckout />`: gasless EIP-3009 checkout for React (built, tested with a fake wallet) |
| `apps/demo-shop` | a store page that adds numa checkout in about 20 lines |
| `docs/` | design, architecture, per-component docs, ADRs; start at [`docs/README.md`](docs/README.md) |
| `arkiv/` | hackathon submission files for the Arkiv track |

Team and workstreams: [`TEAM.md`](TEAM.md). Original brief: `initial-prompt.md`.

## Quick start
Requirements: Node ≥ 22, pnpm 10, Foundry, Docker.
```bash
pnpm install
cp .env.example .env            # fill locally; never commit
docker compose up -d postgres
pnpm contracts:build && pnpm contracts:test
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @numa/web dev     # frontend; falls back to labelled demo data if the API is down
```
Running the API needs router and registry addresses and a relayer key, which exist only after a deployment: see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) and [`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md).

## Whitechain (hackathon track fit)
Primary fit: **Scale · Payments Nobody Notices** (gasless USDT checkout, merchant-covered gas, our own relayer); also **Operate** (drop-in checkout with refunds).

**Why this needs on-chain USDT settlement on Whitechain:** the payment, the three-way split (merchant, creator commission, protocol fee) and the held-then-released commission are enforced by one atomic contract transaction, so a creator can prove a sale from the public chain without trusting the merchant or the platform. A card or bank rail cannot split one payment to an unaffiliated third party at settlement, hold their share against a refund window, or give anyone a publicly checkable receipt.

**Current state against the track requirements** (full checklist in [`docs/WHITECHAIN.md`](docs/WHITECHAIN.md)): contracts are **not deployed yet** and there is **no settled-USDT explorer link yet**; both will be added here as soon as they exist. Feedback for the Whitechain team: [`WHITECHAIN_FEEDBACK.md`](WHITECHAIN_FEEDBACK.md).

## Arkiv (hackathon track: Build on Arkiv)
Marketplace data lives in wallet-owned Arkiv entities on Rabdi (chain 7794095). Submission files: [`schema`](arkiv/schema.md) (entities, indexes, owners, expiry), [`how-you-use-arkiv`](arkiv/how-you-use-arkiv.md), [`why-arkiv`](arkiv/why-arkiv.md), [`reach`](arkiv/reach.md), [`friction`](arkiv/friction.md).
- **Writer wallets:** the numa writer is `0x53FFc438d1389087e0159F024C2C85cC08eA32B3`; the demo merchant and creator wallets are listed in `arkiv/schema.md`.
- **A query you can run** (read-only, no key needed): `pnpm install && pnpm --filter @numa/arkiv query:example` lists live campaigns by commission, open creators and live offers, each with its owner wallet.
- **Re-run the import:** `pnpm --filter @numa/arkiv seed:demo -- --yes` (dry run without `--yes`). Verify the SDK round trips with `live:check` and `live:agents` (need `.env` keys and a little tGLM).
- The demo entities are `[DEMO]`-prefixed and are not tied to on-chain campaigns or real sales.
- The web app's discovery screens read these entities through `apps/api` (`/discovery/*`).

## How we used AI
AI coding assistance (Claude Code) helped write and review code and docs in this repository, under the direction of the three human team members, who reviewed and are responsible for all commits. AI is a tool here, not a contributor (see `TEAM.md`). Claims in `docs/PROJECT_STATUS.md` were checked against tests and live runs, and anything unverified is labelled as such.

## Known limitations
Self-purchases through alternate wallets, sybils, merchant collusion, refund abuse, relayer availability and gas funding are not solved. Reputation weighs distinct payers but does not prove audience authenticity. Checkout is crypto-only. See [`docs/SECURITY.md`](docs/SECURITY.md).

## License
MIT, see [`LICENSE`](LICENSE).

# Project Status (single source of truth)

| Phase | Status |
|---|---|
| 0 Repo audit | Done (`REPOSITORY_AUDIT.md`) |
| 1 Research | Partial: Whitechain/USDT EIP-3009 verified, refund funding model resolved (`DECISIONS/0001-refund-funding-model.md`). Arkiv: TODO (owner: Member 2) |
| 2 Foundation | Partial: monorepo skeleton, Foundry + OpenZeppelin, compose, env, `packages/shared` ABI/types export. No app scaffolds, CI, lint, or root tsconfig yet |
| 3 Contracts | **Done** (local): `CampaignRegistry.sol` + `NumaRouter.sol` implemented, 41/41 Foundry tests passing (unit + fuzz, incl. 512-run payout-split invariant). **Not deployed to Whitechain Sepolia yet** — needs a human with a funded keystore (owner: Member 1). See `docs/SMART_CONTRACTS.md` |
| 4 Arkiv + backend | Not started |
| 5 Frontend | Not started |
| 6 SDK + demo shop | Not started |
| 7 E2E | Not started |

Nothing is deployed. Gasless checkout is NOT yet demonstrated.

## Contracts handoff (Member 1 → Member 2 / Member 3, per `TEAM.md`)
- ABIs: `packages/shared/src/abis/{CampaignRegistry,NumaRouter}.json` (regenerate after any contract change: `pnpm contracts:build` then re-export, see `docs/SMART_CONTRACTS.md`).
- Order struct + EIP-712 typed-data definition for signing: `packages/shared/src/contracts-types.ts`.
- Events to index: `OrderSettled`, `OrderRefunded`, `CommissionReleased` (NumaRouter); `CampaignCreated`, `CreatorApproved`, `CreatorRevoked`, `CampaignPaused` (CampaignRegistry).
- Deployed addresses: `packages/shared/src/addresses.ts` — currently empty, populate after the first testnet deploy.
- Integration requirement for merchants (frontend/SDK, Member 3): merchants must `USDT.approve(NumaRouter, ...)` to fund refunds — see the ADR.
- `packages/shared` has no build step or tsconfig yet (none exists repo-wide) — whoever sets up Phase 2 TS tooling should wire this package in.

## Open decisions
- Project name: **numa** (renamed from "Outcome" by the user; brief text still says Outcome — contract is `NumaRouter`).

## Blockers
- Whitechain testnet deployment needs a human-funded Foundry keystore (WBT for gas) — the agent's shell has no TTY for keystore signing. Owner: Member 1. See `docs/SMART_CONTRACTS.md` → Deployment.
- `pnpm contracts:build` / `pnpm contracts:test` (the root package.json scripts) currently fail in this environment with a corepack signature-verification error on `pnpm@10.34.9` (network/registry issue, unrelated to the contracts code). Verified directly with `forge build` / `forge test -vv` instead — both pass (41/41 tests). Whoever has a working `pnpm` locally should confirm the root scripts also work end-to-end.

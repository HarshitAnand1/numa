# Project Status (single source of truth)

| Phase | Status |
|---|---|
| 0 Repo audit | Done (`REPOSITORY_AUDIT.md`) |
| 1 Research | Partial: Whitechain/USDT EIP-3009 verified. Arkiv, refund funding model: TODO |
| 2 Foundation | Partial: monorepo skeleton, Foundry + OpenZeppelin, compose, env. No app scaffolds, CI, lint yet |
| 3 Contracts | Not started |
| 4 Arkiv + backend | Not started |
| 5 Frontend | Not started |
| 6 SDK + demo shop | Not started |
| 7 E2E | Not started |

Nothing is deployed. Gasless checkout is NOT yet demonstrated.

## Open decisions
- Refund funding model (merchant net is paid instantly; refund needs merchant-approved USDT pull or escrow of refundable portion). Needs ADR.
- Project name: **numa** (renamed from "Outcome" by the user; brief text still says Outcome — contract is `NumaRouter`).

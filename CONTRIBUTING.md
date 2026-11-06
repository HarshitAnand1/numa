# Contributing
- Branch from `main` and open a pull request: `feat/<topic>` for features, `docs/<topic>` for documentation, `fix/<topic>` for fixes.
- Stay within your workstream's files (see `TEAM.md`); coordinate for shared files (`packages/shared`, `docs/`, `.env.example`).
- A PR needs one review from another member and green CI (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `forge build`, `forge test`).
- Commit `pnpm-lock.yaml` when dependencies change: CI installs with `--frozen-lockfile`.
- Never commit secrets (`.env` is gitignored). Never print or log private keys.
- Keep docs honest: update `docs/PROJECT_STATUS.md` when status changes, mark anything unverified as unverified, and do not describe planned features as implemented.
- AI assistance is a tool, not a contributor: do not add AI co-author trailers or bylines to commits or pull requests.

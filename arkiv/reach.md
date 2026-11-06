# Reach

**Who is it for?** Two groups: online merchants who want to pay creators only for real, settled sales, and creators (YouTubers, streamers, writers) who want proof of conversions that they own and can carry between merchants. Both get a drop-in USDT checkout (no Stripe, no fraud-prone click payouts) and a shared Arkiv directory.

**Can they try it today?** Partially, and we say so plainly.
- Discovery (campaigns, creators, leaderboard) reads live Arkiv data and works today. Run `pnpm --filter @numa/arkiv query:example` (read-only, no key needed), or browse the entities in the explorer from [schema.md](schema.md).
- The seeded rows are `[DEMO]` data we published ourselves. We have **no real users and no real sales yet**.
- Gasless checkout depends on the Whitechain Sepolia deployment. Status is tracked in [`docs/PROJECT_STATUS.md`](../docs/PROJECT_STATUS.md); do not assume it is live unless that file says so.

**Will we keep building?** TODO(team): state the real commitment after Mumbai. We will not claim one here until the team has decided.

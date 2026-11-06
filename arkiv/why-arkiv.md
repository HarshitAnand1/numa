# Why Arkiv

**If we swapped Arkiv for Postgres, what would users lose?**
- **Ownership they can prove.** A merchant's campaign and a creator's profile/offer/link are owned by their own wallets. In Postgres, our server owns every row and users must trust us. With Arkiv, anyone can query and check `$owner` against the on-chain `CampaignRegistry` merchant without asking us.
- **Portability.** The marketplace directory is readable by any app, not locked behind our API. Another checkout or creator tool can read the same profiles and campaigns.
- **Self-cleaning state.** Offers (72h), invites (48h) and profiles (90d, renewable) expire on-chain; there is no cron, and stale rows cannot be served by mistake.
- **A trustworthy public record.** Conversions mirror settled payments. Anyone can recompute a creator's reputation from Arkiv entities plus `OrderSettled` events instead of trusting our database.

**What we kept off Arkiv, and why**
- **Money and keys**: only on-chain (`NumaRouter`); Arkiv holds no funds or secrets.
- **Relayer queue, spend caps, per-address limits, indexer cursor, release queue, click analytics**: Postgres. They are operational, high-write, private to our server and need transactions and cleanup. Putting click events on Arkiv would cost gas per click for data nobody else needs.
- **Order sessions / unsigned orders**: server-side; they are single-use and short-lived.

Honest limit: Arkiv does not stop a wallet from writing a fake entity. That is why every trust decision in `apps/api` checks `$owner` and, where money is involved, the chain.

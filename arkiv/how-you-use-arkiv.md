# How we use Arkiv

**Do the fields we filter on, who edits each entity, and when it expires fit the app?**

| What users do | Query we run | Why it fits |
|---|---|---|
| Creator browses deals | campaigns by `category`, `region`, `commissionBps >= x`, sorted by `commissionBps` desc or `endsAt` asc | exactly the filters a creator uses; `endsAt` sorting shows "ending soon" |
| Merchant searches creators | profiles by `niche`, `open = true`, `minAskBps <= x` | profiles carry the price floor and availability |
| Trending | live `numa.offer` rows grouped by `campaignId` | offers expire at 72h, so "live offers" is a natural interest window with no cleanup job |
| Creator inbox | invites by `creator = me` | invites expire at 48h; stale ones vanish |
| Link verification | link by `code` + `campaignId`, `.ownedBy(expectedCreator)` | a forged link by another wallet is not returned |
| Leaderboard | conversions `.ownedBy(writer)` sorted by gross, `paidAt >=` window | owner filter = trust anchor |

**Who can edit what.** Each entity is edited only by its owner wallet: merchant (campaign, decision, invite, endorsement), creator (profile, offer, link), Numa writer (conversion). Owner checks run on every read. See [schema.md](schema.md).

**Expiry is a product feature, not cleanup.** Offers (72h) and invites (48h) go stale on their own; a profile (90 days) disappears unless the creator renews it, so a live profile means an active creator; a campaign ends when it ends.

**Does each Arkiv feature change what users see?** Owner filtering decides which links, invites and conversions are shown as real. Indexed filters and sorting drive the campaign, creator and leaderboard screens (`apps/web` reads `apps/api` `/discovery/*`). Expiry removes stale offers and invites.

**Verified live on Rabdi** (`pnpm --filter @numa/arkiv live:check`, 9/9): every entity type round-tripped by its real owner; owner filtering, sorted queries and offset pagination behave as above. Also verified live: a link found by code alone (`findLinksByCode`), a creator's own offers (`listOffersByCreator`), agent bindings and negotiation threads (`live:agents`, 4/4), and browser-wallet-style writes through a stand-in injected wallet (`live:browser`, 3/3). Not verified: entity expiry actually firing (cannot wait out 48h+), 100-row pages, a real browser extension wallet such as MetaMask, large payloads.

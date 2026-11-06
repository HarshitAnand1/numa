# Arkiv integration (`packages/arkiv`)

SDK: `@arkiv-network/sdk@1.0.1` (pinned; docs differ across 0.4–1.0, so everything here was taken from the installed 1.0.1 package README/types). Not covered by an on-chain write test yet — see "Verified vs not".

## Network
Testnet **Rabdi**, chain id `7794095`, native token tGLM (gas), RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`. Arkiv is a separate chain from Whitechain: every writing wallet (merchant, creator, Numa writer) needs tGLM from https://hub.arkiv.network/faucet. A free access key (https://hub.arkiv.network/access-keys, `ARKIV_ACCESS_KEY`) avoids the heavy public rate limit.

## Facts that shape the design
- Entity owner = creating wallet (`$owner`); queries can filter with `.ownedBy(addr)`. Anyone can write an entity with any schema, so **readers must check ownership** (done in `resolveLink`, `listDecisions`, `listConversions`).
- Only `.indexed()` columns are filterable. A query needs ≥1 filter (no "match everything").
- Pagination: `limit` (≤100/page) + `offset`; page by `gt("$key", …)` for stable reads while others write.
- Entities that don't fit the schema are skipped (`skipped` count) instead of failing the page.
- Max lifetime ≈ **182 days** past the create/extend block. A campaign's entity lives to end+7d, so campaigns longer than ~175 days can't be published.
- `extendEntity` sets a new (later) expiry; `patchEntity` updates columns; `changeOwnership` exists.

## Entities (schemas in `src/schemas.ts`)
| Schema | Owner | Indexed columns | Expiry |
|---|---|---|---|
| `numa.campaign` | merchant | campaignId, status, category, commissionBps, endsAt, region (+ name, description stored) | endsAt + 7d |
| `numa.offer` | creator | campaignId, channel, askBps (+ audience, expectedReach) | 72h |
| `numa.decision` | merchant | offerKey, campaignId, result (+ approveTx) | campaign end |
| `numa.link` | creator | code, campaignId | creator-chosen days |
| `numa.conversion` | Numa writer wallet | creator, merchant, campaignId, status, paidAt, txHash, orderId (+ gross, commission) | 90d |
`campaignId` and `orderId` are additions to the brief's attribute lists (needed to join to chain data). `numa.conversion` rows are only trusted when owned by the configured writer wallet **and** matching an `OrderSettled` event.

## Discovery layer — profiles, invites, endorsements (`src/creators.ts`)
These make Arkiv the marketplace's shared, queryable directory — no central creators table.
| Schema | Owner | Indexed | Expiry | Role |
|---|---|---|---|---|
| `numa.profile` | creator | niche, channel, minAskBps, open | 90d, renewable (`renewProfile`) | merchants search creators by niche/price/availability; a live profile = an active creator |
| `numa.invite` | merchant | campaignId, creator | 48h | targeted invitation; creator queries by own address |
| `numa.endorsement` | merchant | creator, campaignId, orderId, rating | 180d | rating tied to a settled order; counts only if verified |
Query-only features (no entity): campaigns sorted by commission / ending soon; **trending** = campaigns ranked by live offers (offers expire at 72h, so live offers are a natural 72h interest window); **leaderboard** = verified-conversion reputation ranking (conversions sorted by gross, ≥ filter on `paidAt`); **recommendations** = profile niches + min ask vs active campaigns.

### Trust model (anyone can write any entity)
| Claim read from Arkiv | Accepted only if |
|---|---|
| link | owned by the expected creator |
| decision | owned by the campaign's merchant |
| conversion | owned by the Numa writer **and** matches `OrderSettled` (creator, merchant, campaign, gross, commission) |
| endorsement | tx has `OrderSettled` for `orderId` whose **merchant == endorsement author**, creator + campaign match; one per order |
| invite / campaign | `merchantVerified`/`verified` = Arkiv owner equals `CampaignRegistry.merchantOf(campaignId)` (needs `CAMPAIGN_REGISTRY_ADDRESS`; otherwise reported as `null` = unknown, never silently `true`) |
Profiles are self-asserted (a creator's own words); their *verified* numbers come from conversions/endorsements, never from the profile. Endorsement collusion (merchant + creator) and sybil buyers are not prevented.

## API (`src/entities.ts`)
`publishCampaign/Offer/Decision/Link/Conversion(writer, …)`, `listCampaigns(reader, filter)`, `listOffers`, `listDecisions(reader, campaignId, merchant)`, `resolveLink({code, campaignId, expectedCreator})`, `listConversions({creator, writer})`. Clients: `createArkivReader`, `createArkivWriter({account, transport?})` (browser wallets pass their own).

## Verified vs not
- Verified: package typechecks against SDK 1.0.1; read connection to Rabdi works (chain id, block number); 9 offline unit tests (ownership filters, expiry rules, validation).
- **Also not verified:** profile/invite/endorsement writes, `orderBy` and `extendEntity`/`patchEntity` on live Arkiv; `merchantOf` assumes a function Member 1 hasn't written yet.
- **Not verified:** any real `createEntity`/query round-trip (needs a tGLM-funded wallet); attribute value ranges for `u256`; behavior of `ownedBy` combined with schema filter on live data; indexing latency. Do this first once a wallet is funded.

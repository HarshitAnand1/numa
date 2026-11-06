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

## API (`src/entities.ts`)
`publishCampaign/Offer/Decision/Link/Conversion(writer, …)`, `listCampaigns(reader, filter)`, `listOffers`, `listDecisions(reader, campaignId, merchant)`, `resolveLink({code, campaignId, expectedCreator})`, `listConversions({creator, writer})`. Clients: `createArkivReader`, `createArkivWriter({account, transport?})` (browser wallets pass their own).

## Verified vs not
- Verified: package typechecks against SDK 1.0.1; read connection to Rabdi works (chain id, block number); 9 offline unit tests (ownership filters, expiry rules, validation).
- **Not verified:** any real `createEntity`/query round-trip (needs a tGLM-funded wallet); attribute value ranges for `u256`; behavior of `ownedBy` combined with schema filter on live data; indexing latency. Do this first once a wallet is funded.

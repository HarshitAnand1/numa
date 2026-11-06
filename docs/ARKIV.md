# Arkiv integration (`packages/arkiv`)

SDK: `@arkiv-network/sdk@1.0.1` (pinned; docs differ across 0.4–1.0, so everything here was taken from the installed 1.0.1 package README/types). Round trips are verified live on Rabdi; see "Verified vs not".

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
| `numa.agent` | creator or merchant (principal) | agent, role | 30d, delete to revoke | delegates writing negotiation messages to an agent wallet |
| `numa.negotiation` | agent wallet or principal | offerKey, campaignId, creator, merchant, from, seq, action | 72h | one message per negotiation round; see `AGENTS.md` |
Query-only features (no entity): campaigns sorted by commission / ending soon; **trending** = campaigns ranked by live offers (offers expire at 72h, so live offers are a natural 72h interest window); **leaderboard** = verified-conversion reputation ranking (conversions sorted by gross, ≥ filter on `paidAt`); **recommendations** = profile niches + min ask vs active campaigns.

### Trust model (anyone can write any entity)
| Claim read from Arkiv | Accepted only if |
|---|---|
| link | owned by the expected creator |
| decision | owned by the campaign's merchant |
| conversion | owned by the Numa writer **and** matches `OrderSettled` (creator, merchant, campaign, gross, commission) |
| endorsement | tx has `OrderSettled` for `orderId` whose **merchant == endorsement author**, creator + campaign match; one per order |
| invite / campaign | `merchantVerified`/`verified` = Arkiv owner equals `CampaignRegistry.getCampaign(campaignId).merchant` (needs `CAMPAIGN_REGISTRY_ADDRESS`; otherwise reported as `null` = unknown, never silently `true`) |
| negotiation message | owned by the principal for its `from` role, or by an agent wallet named in a live `numa.agent` entity owned by that principal; see `AGENTS.md` |
Profiles are self-asserted (a creator's own words); their *verified* numbers come from conversions/endorsements, never from the profile. Endorsement collusion (merchant + creator) and sybil buyers are not prevented.

## API (`src/entities.ts`)
`publishCampaign/Offer/Decision/Link/Conversion(writer, …)`, `listCampaigns(reader, filter)`, `listOffers`, `listDecisions(reader, campaignId, merchant)`, `resolveLink({code, campaignId, expectedCreator})`, `listConversions({creator, writer})`. Clients: `createArkivReader`, `createArkivWriter({account, transport?})` (browser wallets pass their own).

## Writing safely on Rabdi (`src/safeWriter.ts`)
Per Arkiv's write-safety guidance, default gas estimation can run out of gas on Rabdi, so every write must carry an explicit nonce, gas and gasPrice. `createArkivWriter` therefore returns a `SafeWriter` that: serializes writes per account, verifies chain id 7794095, requires latest==pending nonce, injects `{nonce, gas=1,000,000, gasPrice}`, rejects a tx whose `gas*gasPrice` exceeds `maxCostWei` (default 0.05 tGLM) or the balance, and never auto-retries. Caller-supplied tx params are ignored. Large payloads would need ≥2× a measured estimate (not implemented; our entities are small). Browser wallets build the same wrapper with `createSafeWriter(wallet, reader, address)`.
The Arkiv MCP (mcp.arkiv.network) is knowledge/verification only and never signs; all writes go through the SDK.

## Browser wallets
`createArkivBrowserWriter({ provider: window.ethereum, address })` builds the same SafeWriter over an injected EIP-1193 wallet; `rabdiAddChainParams()` gives the `wallet_addEthereumChain` parameters (public RPC, no access key). The UI must add or switch to Rabdi (chain 7794095) first and the user needs tGLM from https://hub.arkiv.network/faucet.
- **Verified live (`pnpm --filter @numa/arkiv live:browser`, 3/3):** through a stand-in injected wallet (JSON-RPC account, `eth_sendTransaction`, signing and broadcasting outside the SDK) the SafeWriter's writes succeed on Rabdi, two sequential writes don't collide on nonce, and the entity reads back under the wallet's address. The wallet request carried `from,to,data,gas,gasPrice,nonce`.
- **Not verified:** a real extension (MetaMask etc.). It may show its own gas UI, re-estimate or override gas, price or nonce; the wallet's own chain is not checked by the SafeWriter (it checks the *reader's* chain), so a wallet left on another network would send there. Test by hand: connect, add Rabdi, fund, publish a `numa.agent` binding, then confirm `GET /agents/binding` reports `bound: true`. If the wallet rewrites gas, raise `gas` or pass a larger `maxCostWei`. Report any rewrite you see.

## Live checks
`pnpm --filter @numa/arkiv live:check -- --check` (read-only: chain, balances, cost estimate) then `pnpm --filter @numa/arkiv live:check`. Needs `ARKIV_WRITER_PRIVATE_KEY`, `ARKIV_TEST_MERCHANT_KEY`, `ARKIV_TEST_CREATOR_KEY`, `ARKIV_ACCESS_KEY` in `.env`; fund only the writer (it funds the others, ≈0.022 tGLM at 1 gwei). It publishes each entity type as its real owner, asserts reads and owner filtering (a decision, link or conversion is *not* returned under a non-owner wallet), measures indexing latency, then deletes everything it created. Its conversion/endorsement rows are synthetic (obviously fake order ids) and exist only for the duration of the test.

## Verified vs not
**Verified live on Rabdi (2026-11-06, `live:check`, 7/7 passed):** a real profile, campaign, offer, decision, link, invite, endorsement and conversion were each created by their real owner wallet and read back through our query functions; profile `setProfileAvailability` and `renewProfile` worked; owner filtering held (a decision under a non-owner wallet, a link for the wrong creator and a conversion under a non-writer owner were *not* returned); `ownedBy` + schema filters work together. **Second run (9/9): sorted queries verified live** — campaigns by highest commission and by ending soonest, conversions by largest gross; **offset pagination verified** (pages of 2 over 5 offers return each exactly once, `listOffers` sorts by `$key` for stable pages). Indexing latency observed: ~0.3 s for single entities, ~0.6–1.1 s for invites/endorsements (a handful of samples, not a benchmark). All created entities were deleted afterwards (delete txs confirmed). Gas floor of 1,000,000 was sufficient for these small entities.
**Not verified:** a full 100-row page (pagination was exercised with page size 2, same code path); entity *expiry* firing (72h/90d lifetimes can't be waited out in a test; renewal via `extendEntity` was exercised); large payloads; browser-wallet writes; real conversions (the test's conversion/endorsement rows were synthetic with fake order ids and are not evidence of a sale); the owner check against the deployed `CampaignRegistry` (the backend now reads `getCampaign(id).merchant`, tested with mocks only).
**Also verified live (2026-11-07):** `live:browser` (3/3, a stand-in injected wallet, see "Browser wallets"). `live:agents` (4/4): a binding is visible only under the principal that published it, an agent's two-round thread reads back in order, and a stranger's forged message fails authorization. `seed:demo` published 4 campaigns, 4 profiles and 4 offers, read back through the discovery functions.

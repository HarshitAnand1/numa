# API (`apps/api`)

All routes below are implemented. Amounts are decimal strings (bigints are never emitted as JSON numbers). Features that need Arkiv or the registry are enabled by configuration and say so.

## Operational notes
- **Blank settings are unset.** `FOO=` (as shipped in `.env.example`) means "not set": optional features stay off and defaults apply. Mandatory settings left blank are reported as missing.
- **RPC URL** must be `https`; plain `http` is accepted only for a local node (`127.0.0.1` / `localhost`).
- **CORS:** off by default. `CORS_ORIGINS` is a comma-separated allowlist of browser origins (or `*`). Preflight is answered with 204.
- **Rate limit:** `RATE_LIMIT_PER_MINUTE` globally (default 30); `/r/:code` has its own much higher limit.
- **Discovery timeout:** `/discovery/*` and `/creators/*` return `504 {"error":"UPSTREAM_TIMEOUT"}` after `DISCOVERY_TIMEOUT_MS` (default 15000) instead of hanging on Arkiv.

## Orders, relaying, links
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness, relayer address and WBT balance |
| POST | `/orders` | **Demo** merchant order service: signs an EIP-712 `Order` with `MERCHANT_SIGNER_KEY`, reading the merchant, commission and fee from chain. Real merchants sign in their own backend with `@numa/sdk-server`. 501 if the key or registry address is unset, 404 for an unknown campaign |
| POST | `/relay` | Submit the buyer's EIP-3009 authorization plus the signed order; the relayer calls `payOrder` |
| GET | `/relay/:orderId` | Relay outcome `{orderId, status: claimed\|sent\|settled\|reverted, txHash, explorer}`; 404 if unknown |
| GET | `/r/:code` | Attribution-link click tracker: records the click (salted hash of ip + user-agent, never the raw ip) and 302s to `CHECKOUT_BASE_URL/checkout/<code>`. **Clicks never create commission.** |
| GET | `/links/:code/stats?creator&campaignId` | `{clicks, uniqueVisitors, settled}`. With Arkiv configured the link must be owned by `creator`, and `settled` counts only chain-verified sales |

`POST /orders` body: `{ campaignId: "7", creator: "0x..", buyer: "0x..", amount: "25.00", orderId?: "0x<32 bytes>" }`
→ `{ order{campaignId,merchant,creator,buyer,gross,orderId,deadline}, digest, authNonce, merchantSig, payoutSigner, router, chainId }` (the same shape as `@numa/sdk-server`'s `OrderPayload`). The buyer must use `authNonce` as the EIP-3009 nonce (it is the `OrderCommitment`; see ADR 0005).

`POST /relay` body: `{ order, merchantSig, auth:{validAfter,validBefore,v,r,s} }` (`order` is exactly the object returned by `/orders`)
→ `{ status:"settled", txHash, blockNumber }` or `{ error: CODE, message }`.
Codes: `ORDER_EXPIRED`, `BAD_AUTH_WINDOW`, `BAD_SELF_PURCHASE`, `BAD_MERCHANT_SIG`, `BAD_BUYER_AUTH`, `DUPLICATE` (409), `GAS_PRICE_TOO_HIGH`, `DAILY_CAP_EXCEEDED`, `ADDRESS_LIMIT_EXCEEDED`, `INSUFFICIENT_RELAYER_BALANCE`, `SIMULATION_FAILED`, `TX_REVERTED`, `TX_TIMEOUT` (all 422 unless noted).

## Receipts and the accountant export
Rebuilt from chain data (public), so no auth. Set `INDEXER_START_BLOCK` to the router's deployment block: the export scans from there in 2,000-block chunks and refuses a range wider than 200 chunks (`400 RANGE_TOO_LARGE`; pass `fromBlock`).

| Path | Returns |
|---|---|
| `GET /receipts/:orderId` | Customer receipt from the router's settlement record: parties, `grossUsdt`, `protocolFeeUsdt`, `creatorCommissionUsdt`, `merchantNetUsdt`, `refundedUsdt`, `commissionStillHeldUsdt`, `commissionReleased`, `status` (held, released, partially_refunded, refunded), and `txHash` + `explorerUrl` when this relayer submitted the order (otherwise null). 404 if the order never settled |
| `GET /merchants/:address/orders?fromBlock&toBlock&format=csv` | The merchant's ledger: one row per settled order with refunds and release folded in. JSON by default, `format=csv` downloads a CSV (columns: `date_utc, order_id, tx_hash, campaign_id, buyer, creator, gross_usdt, protocol_fee_usdt, creator_commission_usdt, merchant_net_usdt, refunded_usdt, merchant_refund_cost_usdt, merchant_net_after_refunds_usdt, commission_released_usdt, status`). Every cell is a number, hex string or fixed word, so nothing needs escaping |

## Discovery layer
Enabled only when `ARKIV_WRITER_PRIVATE_KEY` is set. `CAMPAIGN_REGISTRY_ADDRESS` enables on-chain ownership verification; without it the verification flags are `null` (unknown), never `true`.

| Path | Returns |
|---|---|
| `GET /discovery/campaigns?category&region&minCommissionBps&sort=commission\|endingSoon&limit` | active campaigns + `merchantVerified` |
| `GET /discovery/trending?limit` | campaigns ranked by live offers (72h), then commission, with `offerCount` |
| `GET /discovery/creators?niche&channel&maxAskBps&openOnly&limit` | live profiles + `{score, verifiedConversions, label}` (merchant-side search) |
| `GET /discovery/leaderboard?campaignId&days&limit` | creators ranked by verified reputation (chain-verified conversions only) |
| `GET /campaigns/:id/offers?limit&offset` | **Offers on a campaign** for the merchant's review screen, each with the creator's profile summary, `decision` (approved/rejected; trusted only when authored by the campaign's on-chain merchant, else null) and `approvedOnChain` (the registry's `isCreatorApproved`, the authority; null without a registry). Paged, max 50 per page |
| `GET /links/:code` | **Resolve a link code** to `{code, creator, campaignId, merchant, approved, settleable, claims}`, so `/r/:code` → `/checkout/<code>` works on its own. Anyone can publish a link with any code, so a candidate counts only if its owner is **approved for that campaign on-chain**; unapproved squatters are ignored (`404 NOT_APPROVED` if none qualify). If several approved creators claimed the code, the earliest claim (creation block) wins and `claims` shows the conflict. `settleable` is false for a paused or ended campaign. Needs `CAMPAIGN_REGISTRY_ADDRESS` (503 without it) |
| `GET /creators/:address/offers?limit&offset` | A creator's **own** live offers, each with `campaignName`, the merchant's `decision` (trusted only if authored by the campaign's on-chain merchant), `approvedOnChain`, and a derived `status` of `approved`, `rejected` or `pending` (on-chain approval wins). Paged, max 50 |
| `GET /creators/:address` | **creator card**: profile, reputation, verified endorsements `{count, averageRating, items}`, recent verified sales, rejected claims |
| `GET /creators/:address/reputation` | `{ verifiedConversions, distinctPayers, grossSettled, commissionEarned, score\|null, label, rejected[] }` |
| `GET /creators/:address/recommendations` | active campaigns matching the creator's niches and minimum ask (404 without a profile) |
| `GET /creators/:address/invites` | invites with `verified` (inviter == the campaign's on-chain merchant) |

The same configuration starts the **indexer** (`INDEXER_POLL_MS`): it reads router events from `INDEXER_START_BLOCK`, publishes `numa.conversion` entities (idempotent by `orderId`) and updates their status on release or refund. The cursor lives in Postgres (`indexer_cursor`) when `DATABASE_URL` is set, otherwise in memory (a restart re-scans from `INDEXER_START_BLOCK`: safe, slower). The indexer also runs without an Arkiv key; it then mirrors nothing but still feeds the release keeper.

## Negotiation agents
Enabled only when `AGENT_WALLET_PRIVATE_KEY`, an Arkiv reader and `CAMPAIGN_REGISTRY_ADDRESS` are set. Design: [`AGENTS.md`](AGENTS.md).

| Path | Purpose |
|---|---|
| `GET /agents/status` | `{enabled, agentAddress}`: the wallet a principal must bind with a `numa.agent` entity |
| `POST /agents/policy` | Create or update private guardrails. Body `{policy, issuedAt, signature}`; the signature is EIP-191 over `policyAuthMessage("write", …)` by the principal and must be fresh (5 min) |
| `POST /agents/policy/read` | Read your own policy. Body `{principal, role, issuedAt, signature}` signed the same way with action `read` |
| `GET /agents/binding?principal=0x…&role=creator\|merchant` | Is the agent connected? `{enabled, agentAddress, bound, bindings[]}`; `bound` is true only when a live `numa.agent` entity owned by the principal names the API's agent wallet. Reads Arkiv, so the UI never has to |
| `GET /agents/threads?principal=0x…&role=creator\|merchant&limit` | "My threads" feed: every live offer the principal is party to (creator: offers they own; merchant: offers on campaigns whose on-chain merchant is the principal), most advanced first. Each item: `{offerKey, campaignId, campaignName, creator, merchant, offerAskBps, state: open\|deal\|rejected, agreedBps?, round, messageCount, ignoredMessages, last?{from,action,bps,note,seq}}`. `ignoredMessages` counts messages that failed verification. Public data, so no signature |
| `GET /agents/threads/:offerKey` | Public, verified negotiation thread for one offer (all messages) |
| `GET /agents/deals?merchant=0x…` | Deals reached for that merchant, with the on-chain steps the merchant must sign (`approveCreator`, or `createCampaign` then `approveCreator`) |

**Signed text.** Build it with `policyAuthMessage(action, principal, role, issuedAt, body)` from `@numa/shared`; do not hand-write it. The body is serialized as canonical JSON (sorted keys), so key order cannot break a signature. Sign it with `personal_sign` and send the same `body` object you signed.

Policy fields: `role`, `enabled`, `limitBps` (creator floor / merchant ceiling), `openingBps`, `autoAcceptBps`, `stepBps` (10-1000), `maxRounds` (1-10), `categories`. Contradictory limits are rejected with `400 BAD_POLICY`.

## Reputation formula
`score = round(100 · (0.5·G + 0.5·N) · (0.5 + 0.5·D))`, `G = 1 − e^(−grossUSDT/1000)`, `N = 1 − e^(−distinctPayers/10)`, `D = distinctPayers / verifiedConversions`. Fully refunded orders are excluded; partial refunds currently count at full gross. No verified sales → `score: null` ("No verified sales history yet"). It does not prove audience authenticity: self-purchases from other wallets and sybils still score.

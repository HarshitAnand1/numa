# API (apps/api) — implemented endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness, relayer address and WBT balance |
| POST | `/orders` | **Demo** merchant order service: signs an EIP-712 `Order` with `MERCHANT_SIGNER_KEY`. Real merchants sign in their own backend (`@numa/sdk-server`, not built yet). 501 if key unset |
| GET | `/relay/:orderId` | Relay outcome for an order: `{orderId, status: claimed\|sent\|settled\|reverted, txHash, explorer}`; 404 if unknown |
| POST | `/relay` | Submit buyer's EIP-3009 authorization + signed order; relayer calls `payOrder` |

`POST /orders` body: `{ campaignId: "7", creator: "0x..", amount: "25.00", orderId?: "0x<32 bytes>" }`
→ `{ order{campaignId,orderId,creator,amount,deadline}, digest, merchantSig, merchant }` (bigints as decimal strings).

`POST /relay` body: `{ order, merchantSig, buyer, auth:{validAfter,validBefore,v,r,s} }`
→ `{ status:"settled", txHash, blockNumber }` or `{ error: CODE, message }`.
Codes: ORDER_EXPIRED, BAD_AUTH_WINDOW, BAD_SELF_PURCHASE, BAD_MERCHANT_SIG, BAD_BUYER_AUTH, DUPLICATE (409), GAS_PRICE_TOO_HIGH, DAILY_CAP_EXCEEDED, ADDRESS_LIMIT_EXCEEDED, INSUFFICIENT_RELAYER_BALANCE, SIMULATION_FAILED, TX_REVERTED, TX_TIMEOUT (422).

## Discovery layer (enabled only when `ARKIV_WRITER_PRIVATE_KEY` is set)
All amounts are decimal strings. Optional `CAMPAIGN_REGISTRY_ADDRESS` enables on-chain ownership verification (flags are `null` without it).
| GET | Path | Returns |
|---|---|---|
| | `/discovery/campaigns?category&region&minCommissionBps&sort=commission\|endingSoon&limit` | active campaigns + `merchantVerified` |
| | `/discovery/trending?limit` | campaigns ranked by live offers (72h) then commission, with `offerCount` |
| | `/discovery/creators?niche&channel&maxAskBps&openOnly&limit` | live profiles + `{score, verifiedConversions, label}` (merchant-side search) |
| | `/discovery/leaderboard?campaignId&days&limit` | creators ranked by verified reputation (chain-verified conversions only) |
| | `/creators/:address` | **creator card**: profile, reputation, verified endorsements `{count, averageRating, items}`, recent verified sales, rejected claims |
| | `/creators/:address/recommendations` | active campaigns matching the creator's niches and minimum ask (404 without a profile) |
| | `/creators/:address/invites` | invites with `verified` (inviter == campaign's on-chain merchant) |
| | `/creators/:address/reputation` | reputation only |

## Arkiv-backed details
| GET | `/creators/:address/reputation` | Reads the creator's conversions from Arkiv (owned by the Numa writer), keeps only those verified against the router's `OrderSettled` event, returns `{ verifiedConversions, distinctPayers, grossSettled, commissionEarned, score|null, label, rejected[] }` (amounts as decimal strings). |

The same flag starts the **indexer** loop (`INDEXER_POLL_MS`): reads router events from `INDEXER_START_BLOCK`, publishes `numa.conversion` entities (idempotent by `orderId`) and updates status on release/refund. The cursor is stored in Postgres (`indexer_cursor`) when `DATABASE_URL` is set, otherwise in memory (re-scans from `INDEXER_START_BLOCK` after restart: safe, slower).

### Reputation formula
`score = round(100 · (0.5·G + 0.5·N) · (0.5 + 0.5·D))`, `G = 1 − e^(−grossUSDT/1000)`, `N = 1 − e^(−distinctPayers/10)`, `D = distinctPayers / verifiedConversions`. Fully refunded orders are excluded; partial refunds currently count at full gross. No verified sales → `score: null`, "No verified sales history yet." It does not prove audience authenticity (self-purchases from other wallets and sybils still score).

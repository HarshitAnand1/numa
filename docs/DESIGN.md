# numa — Design Document

> Legend: **[built]** implemented and tested, **[partial]**, **[planned]** not started. Anything not marked built is a plan, not a claim. Live status: `PROJECT_STATUS.md`.

## 1. Executive summary
numa is a drop-in USDT checkout and creator marketplace on Whitechain Sepolia. A creator earns a commission only when a real, buyer-authorized USDT payment settles through `NumaRouter`. Discovery, offers, decisions, attribution links and conversion history live as wallet-owned Arkiv entities. A relayer pays gas so buyers need no WBT.

## 2. Problem
Engagement-based advertising pays for clicks and impressions, which bots fabricate. Merchants pay for fake traffic; honest creators are indistinguishable from fraudulent ones.

## 3. Product goals
Pay only on settled sales; no upfront ad budget; transparent split (merchant net / creator commission / protocol fee); refund protection; gasless buyer checkout; publicly verifiable creator sales history; easy merchant integration (SDK).

## 4. Non-goals
Proving payers are independent humans; fiat/card checkout; off-chain conversion oracles or Stripe webhooks; campaign escrow/ad budgets; mainnet readiness (hackathon MVP on testnet).

## 5. Personas
- **Merchant**: sells a product, wants performance-only marketing.
- **Creator**: has an audience, wants verifiable earnings and reputation.
- **Buyer**: wants a normal checkout, holds USDT only.
- **Judge/verifier**: inspects transactions and Arkiv entities.

## 6. Functional requirements
Merchant: create campaign (chain + Arkiv), review offers, approve creators, monitor settlements/holds/releases, process refunds. Creator: discover campaigns, publish offers, publish links, track conversions/earnings/reputation. Buyer: open link, sign USDT authorization, pay without WBT, see tx hash. Full list: initial brief §11, §22.

## 7. Non-functional requirements
Integer-only money math; no private key exposure; relayer never accepts arbitrary calls; simulate before send; verify receipts; reproducible dev env (pnpm, Docker, Foundry); docs match reality.

## 8. System architecture
See `ARCHITECTURE.md`. Components: web app, API (order service + relayer + indexer + reputation), Arkiv module, two contracts, Postgres for operational data, demo shop, SDK packages.

## 9. Components
| Component | Owner | Status |
|---|---|---|
| `packages/contracts` (CampaignRegistry, NumaRouter) | Member 1 | [planned] |
| `apps/api` order service, relayer | Member 2 | [built] unit-tested with mocked chain |
| `packages/arkiv` | Member 2 | [built] offline-tested; no live write yet |
| indexer, reputation | Member 2 | [planned] |
| `apps/web`, `apps/demo-shop`, `packages/sdk-react` | Member 3 | [planned] |
| `packages/sdk-server` | Member 2/3 | [planned] |

## 10. Whitechain integration
See `WHITECHAIN.md`. Chain 1874; USDT is an EIP-1967 proxy whose implementation exposes EIP-3009 (`receiveWithAuthorization`). Money moves only on Whitechain.

## 11. Arkiv integration
See `ARKIV.md`. Five wallet-owned entity types; Arkiv holds no funds or secrets; readers verify ownership.

## 12. Contract architecture
See `SMART_CONTRACTS.md`.

## 13. EIP-712 order design [partial: types in `packages/shared`, contract not written]
Merchant signs `Order{campaignId, orderId, creator, amount, deadline}` under domain `NumaRouter`/`1`/chainId/router. The router recovers the signer and requires it to equal the campaign's payout signer. `orderId` is single-use. **Proposal pending Member 1's review.**

## 14. EIP-3009 authorization flow
Buyer signs `ReceiveWithAuthorization{from, to=router, value=amount, validAfter, validBefore, nonce}` under the USDT domain (`Tether USD`/`1`/1874/proxy address). `nonce = keccak256(abi.encode(orderDigest, creator))`, binding the payment to one order and creator. `receiveWithAuthorization` requires `msg.sender == to`, so the router is the caller; a front-runner cannot redirect funds. Not yet exercised with a real transfer.

## 15. Relayer architecture [built, mocked]
See `RELAYER.md`. Fixed target/function, guard checks, simulation, receipt verification, caps.

## 16. Refund mechanism [planned — decision pending]
Merchant net is paid instantly, so the router cannot refund from funds it no longer holds. See `DECISIONS/0001-refund-funding-model.md`.

## 17. Commission accounting
`commission = gross·commissionBps/10000`, `fee = gross·feeBps/10000`, `merchantNet = gross − commission − fee`, all rounded down, feeBps ≤ 100, commissionBps ≤ 5000. Held commission tracked per order; proportional clawback on refund; release after window. Invariant: held + released + clawed = commission.

## 18. Creator reputation [planned]
Computed only from conversions whose `txHash` matches an `OrderSettled` event with identical creator, merchant, campaign and amounts. Inputs: gross settled sales, distinct payers, verified conversion count, commission earned. Weighting by gross and distinct payers. No history → "No verified sales history yet." Limitations: self-purchase from alternate wallets and sybils are not detected; the score does not prove audience authenticity.

## 19. Data models
On-chain: campaigns, approvals, orders (`SMART_CONTRACTS.md`). Arkiv: `ARKIV.md`. Postgres (operational only): order sessions, relayer claims/spend, indexer cursor, cache [planned; relayer currently in-memory].

## 20. API design
`API.md` (implemented: `/health`, `/orders`, `/relay`). Planned: `/campaigns` (read-through), `/creators/:addr/reputation`, `/orders/:id` status.

## 21. SDK design [planned]
`SDK.md`.

## 22. Security model / 23. Threat model
`SECURITY.md`.

## 24. Deployment architecture
Contracts: Foundry to Whitechain Sepolia via keystore (human-run). API: single Node service + Postgres via Docker Compose. Web: Next.js. Relayer key funded with WBT; Arkiv writer wallet funded with tGLM.

## 25. Failure handling
Relayer: simulation failure → reject, nothing sent; timeout → keep claim, require explorer check before retry; reverted → report. Indexer: idempotent by `orderId`; resume from stored block cursor. Arkiv lag: UI reads chain events as source of truth for money.

## 26. Known limitations
Self-purchases via other wallets; sybils; merchant collusion; refund abuse; relayer availability and gas funding; crypto-only checkout; Arkiv indexing latency; reputation manipulation. The protocol ties commissions to settled USDT payments, not to genuine human customers.

## 27. Roadmap
Contracts → live gasless proof → indexer/reputation → frontend → SDK/demo shop → e2e → polish. See `PROJECT_STATUS.md`.

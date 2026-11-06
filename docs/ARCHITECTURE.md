# Architecture diagrams
Diagrams show the intended flows. Built and tested: contracts (local), relayer, reconciler, release keeper, indexer, Arkiv module (live-verified on Rabdi), discovery/reputation API, negotiation agents. The frontend's checkout is still mock and nothing is deployed, so no flow here has run end to end on a live chain; see `PROJECT_STATUS.md`.

## System
```mermaid
flowchart LR
  M[Merchant wallet] -->|createCampaign / approveCreator| CR[CampaignRegistry]
  M -->|publish campaign, decision| AR[(Arkiv)]
  C[Creator wallet] -->|publish offer, link| AR
  B[Buyer] -->|signs EIP-3009 auth| WEB[Web / SDK checkout]
  WEB -->|POST /orders| API
  WEB -->|POST /relay| API
  API[API: order service + relayer + indexer + reputation] -->|payOrder, pays gas| R[NumaRouter]
  R --> CR
  R -->|receiveWithAuthorization| U[USDT]
  API -->|reads OrderSettled| R
  API -->|publish conversion| AR
  API --- PG[(Postgres: ops data)]
```

## Campaign lifecycle
```mermaid
stateDiagram-v2
  [*] --> Active: createCampaign (chain) + campaign entity (Arkiv)
  Active --> Paused: pause()
  Paused --> Active: unpause (merchant)
  Active --> Ended: endsAt reached
  Ended --> [*]: Arkiv entity expires (end + 7d)
```

## Offer and approval
```mermaid
sequenceDiagram
  participant Cr as Creator
  participant A as Arkiv
  participant Me as Merchant
  participant CR as CampaignRegistry
  Cr->>A: publish numa.offer (72h expiry)
  Me->>A: query offers for campaign
  Me->>CR: approveCreator(id, creator)
  Me->>A: publish numa.decision (approveTx)
  Cr->>A: publish numa.link (code, campaignId)
```

## Buyer checkout and EIP-3009
```mermaid
sequenceDiagram
  participant Bu as Buyer
  participant W as Checkout
  participant Ms as Merchant server
  participant A as Arkiv
  W->>A: resolve link (owner == creator)
  W->>Ms: createOrder(amount, creator)
  Ms-->>W: Order + EIP-712 merchantSig
  W->>Bu: sign ReceiveWithAuthorization(to=router, nonce=H(digest,creator))
  Bu-->>W: v,r,s
  W->>API: /relay {order, sig, buyer, auth}
```

## Relayer submission
```mermaid
flowchart TD
  A[request] --> V{deadline, auth window, buyer!=creator, sig well-formed}
  V -->|fail| X[reject]
  V --> D{duplicate orderId?}
  D -->|yes| X
  D --> L{per-address limit, gas ceiling}
  L -->|fail| X
  L --> S[simulate payOrder]
  S -->|revert| X
  S --> G{daily cap, relayer balance}
  G -->|fail| X
  G --> T[send tx] --> RC{receipt success?}
  RC -->|yes| OK[settled]
  RC -->|no/timeout| E[report; keep claim, check explorer]
```

## Payment splitting
```mermaid
flowchart LR
  P[gross USDT from buyer] --> R[NumaRouter]
  R -->|gross - commission - fee| MN[Merchant]
  R -->|commission| H[Held per order]
  R -->|fee <= 1%| F[Protocol fee]
  H -->|after window| CR[Creator]
```
(Merchant payout timing depends on ADR 0001.)

## Refund lifecycle
```mermaid
sequenceDiagram
  participant Me as Merchant
  participant R as NumaRouter
  participant Bu as Buyer
  Me->>R: refund(orderId, X)   (funding per ADR 0001)
  R->>Bu: X USDT
  R->>Me: clawback X*commissionBps/10000 from held
  R-->>R: emit OrderRefunded; held reduced
```

## Commission release
```mermaid
sequenceDiagram
  participant Any as Anyone
  participant R as NumaRouter
  participant Cr as Creator
  Any->>R: release(orderId)
  R->>R: require window elapsed, not released
  R->>Cr: remaining held commission
  R-->>R: emit CommissionReleased
```

## Arkiv entity ownership
```mermaid
flowchart LR
  Merchant -->|owns| campaign
  Merchant -->|owns| decision
  Creator -->|owns| offer
  Creator -->|owns| link
  Writer[Numa writer wallet] -->|owns| conversion
```

## Reputation verification
```mermaid
flowchart TD
  Q[query numa.conversion by creator, owner == writer] --> T[fetch tx receipt by txHash]
  T --> E{OrderSettled matches creator, merchant, campaign, gross, commission?}
  E -->|no| SKIP[ignore record]
  E -->|yes| SC[score: gross, distinct payers, count, commission]
```

## Creator discovery layer
```mermaid
flowchart LR
  Cr[Creator] -->|publish/renew| P[numa.profile]
  Me[Merchant] -->|publish| C[numa.campaign]
  Me -->|publish 48h| I[numa.invite]
  Me -->|publish after sale| E[numa.endorsement]
  W[Numa writer] -->|publish| V[numa.conversion]
  P & C & I & E & V --> API[API: verify + rank]
  CH[(Whitechain: OrderSettled, getCampaign.merchant)] --> API
  API --> S1[creator search]
  API --> S2[recommendations]
  API --> S3[trending / leaderboard]
  API --> S4[creator card]
```

## Negotiation agents (see AGENTS.md, ADR 0008)
```mermaid
flowchart LR
  Cr[Creator] -->|publish| O[numa.offer]
  Cr & Me[Merchant] -->|bind, revocable| B[numa.agent]
  PG[(Postgres: private guardrails)] --> R
  O & B --> R[Agent runner]
  R -->|rules engine decides| N[numa.negotiation]
  R -.->|optional: note text only| L[Claude]
  CH[(Whitechain: getCampaign.merchant)] --> R
  N --> D[Deal ticket]
  D -->|merchant signs| Reg[CampaignRegistry.approveCreator / createCampaign]
  Reg --> Sale[Real USDT sale via NumaRouter]
```

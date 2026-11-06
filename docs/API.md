# API (apps/api) — implemented endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness, relayer address and WBT balance |
| POST | `/orders` | **Demo** merchant order service: signs an EIP-712 `Order` with `MERCHANT_SIGNER_KEY`. Real merchants sign in their own backend (`@numa/sdk-server`, not built yet). 501 if key unset |
| POST | `/relay` | Submit buyer's EIP-3009 authorization + signed order; relayer calls `payOrder` |

`POST /orders` body: `{ campaignId: "7", creator: "0x..", amount: "25.00", orderId?: "0x<32 bytes>" }`
→ `{ order{campaignId,orderId,creator,amount,deadline}, digest, merchantSig, merchant }` (bigints as decimal strings).

`POST /relay` body: `{ order, merchantSig, buyer, auth:{validAfter,validBefore,v,r,s} }`
→ `{ status:"settled", txHash, blockNumber }` or `{ error: CODE, message }`.
Codes: ORDER_EXPIRED, BAD_AUTH_WINDOW, BAD_SELF_PURCHASE, BAD_MERCHANT_SIG, DUPLICATE (409), GAS_PRICE_TOO_HIGH, DAILY_CAP_EXCEEDED, ADDRESS_LIMIT_EXCEEDED, INSUFFICIENT_RELAYER_BALANCE, SIMULATION_FAILED, TX_REVERTED, TX_TIMEOUT (422).

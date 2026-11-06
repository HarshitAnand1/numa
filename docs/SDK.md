# Merchant SDK

## Server: `@numa/sdk-server` **[built, unit-tested; not run against a deployed router]**
```ts
import { Numa } from "@numa/sdk-server";

// Read these once from chain: getCampaign(7).merchant / .commissionBps, and NumaRouter.feeBps().
const numa = new Numa({ campaignId: 7, merchant, signerKey: process.env.MERCHANT_SIGNER_KEY as `0x${string}`, router, commissionBps, feeBps });
// numa's signer address must equal the campaign's payoutSigner on-chain.

app.post("/api/order", async (req, res) => {
  // `creator` owns the attribution link the buyer opened; `buyer` is the paying wallet.
  res.json(await numa.createOrder({ amount: "25.00", creator, buyer }));
});
```
`createOrder` returns a JSON-safe `OrderPayload`: `{ order{campaignId,merchant,creator,buyer,amount,orderId,deadline}, digest, authNonce, merchantSig, payoutSigner, router, chainId }`. In the *input*, `amount` is a decimal USDT string with at most 6 decimals (`"25.00"`). In the returned `order`, `amount` is the same value in base units (`"25000000"`), and **`/relay` expects that field to be named `gross`**, so a client must rename it (the API's `POST /orders` already returns `gross`). This naming mismatch is a known rough edge; orders expire after `ttlSeconds` (default 900). `authNonce` is the `OrderCommitment`: the buyer must use it as the EIP-3009 nonce, which binds the payment to this exact order and split (ADR 0005). The signer key stays on the merchant's server.

Notes: `merchant` (the campaign's merchant address) is distinct from the payout-signer key. `creator` and `buyer` are passed per order; direct sales without a creator are not supported by the current design. `OrderSigner` is the lower-level class (explicit campaign per call); the API's demo `POST /orders` uses it.

Merchants must also `USDT.approve(NumaRouter, …)` so refunds can be pulled from them (ADR 0001).

## React: `@numa/sdk-react` **[planned, not started]**
`<NumaCheckout orderUrl="/api/order" onPaid={...} />`: fetch the payload, have the buyer sign `ReceiveWithAuthorization` (`receiveAuthTypedData` in `@numa/shared`, `nonce = authNonce`, `to = router`), POST `{order, merchantSig, auth}` to the relayer's `/relay`, poll `/relay/:orderId`, return the tx hash. Owner: Member 3.

## Demo shop: `apps/demo-shop` **[planned, not started]**
A sample storefront that uses the two packages above end to end.

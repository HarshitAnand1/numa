# Merchant SDK

## Server — `@numa/sdk-server` **[built, unit-tested; not yet run against a deployed router]**
```ts
import { Numa } from "@numa/sdk-server";

const numa = new Numa({ campaignId: 7, signerKey: process.env.MERCHANT_SIGNER_KEY as `0x${string}`, router: "0x…NumaRouter" });
// numa.signerAddress must be set as the campaign's payout signer on-chain.

app.post("/api/order", async (req, res) => {
  // `creator` is the owner of the attribution link the buyer opened.
  res.json(await numa.createOrder({ amount: "25.00", creator }));
});
```
`createOrder` returns a JSON-safe payload: `{ order{campaignId,orderId,creator,amount,deadline}, digest, authNonce, merchantSig, merchant, router, chainId }`. Amounts are decimal USDT strings with ≤6 decimals; orders expire after `ttlSeconds` (default 900). The key stays on the merchant's server. Differences from the brief's sketch: a `router` address is required, and `creator` is passed per order (direct sales without a creator aren't supported by the current design).
Lower-level: `OrderSigner` (explicit campaign per call). The API's demo `/orders` endpoint uses it.

## React — `@numa/sdk-react` **[planned]**
`<NumaCheckout orderUrl="/api/order" onPaid={...} />`: fetch the payload, have the buyer sign `ReceiveWithAuthorization` (`receiveAuthTypedData` in `@numa/shared`, `nonce = authNonce`, `to = router`), POST `{order, merchantSig, buyer, auth}` to the relayer's `/relay`, return the tx hash. Owner: Member 3.

## Demo shop — `apps/demo-shop` **[planned]**

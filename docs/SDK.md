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

## React — `@numa/sdk-react` **[built, unit-tested; never run against a real deployment]**
`<NumaCheckout orderUrl="/api/order" onPaid={...} />`: fetch the payload, have the buyer sign `ReceiveWithAuthorization` (`receiveAuthTypedData` in `@numa/shared`, `nonce = authNonce`, `to = router`), POST `{order, merchantSig, buyer, auth}` to the relayer's `/relay`, return the tx hash. Owner: Member 3.
**Status:** built (`packages/sdk-react`), used by `apps/web` and `apps/demo-shop`. Exports: `NumaCheckout` (drop-in widget, restylable via `numa-*` classes), `NumaProvider` / `numaWagmiConfig` (injected wallets only, Whitechain only), the `useCheckout` hook for custom UIs, and the pure pieces (`verifyOrderPayload`, `buildAuthTypedData`, `toRelayBody`, `describeRelayFailure`, ...). The verification step is the point: **the buyer is only asked to sign after the order service's answer is re-derived from the contracts** (right buyer, creator, campaign and exact amount; the campaign's own merchant and payout signer; settleable campaign, approved creator; nonce recomputed from on-chain commission and fee). Nothing is signed if any check fails.
```tsx
<NumaProvider>
  <NumaCheckout
    config={{ chainId: 1874, router, registry, token, orderUrl: "/api/order", relayUrl: "https://…/relay" }}
    params={{ campaignId: "7", creator, amount: "25.00" }}
    onPaid={({ txHash }) => …}
  />
</NumaProvider>
```
`orderUrl` receives `POST { campaignId, creator, buyer, amount }` and must answer with the signed order (`@numa/sdk-server`'s `createOrder`; the order now names the buyer, so the older sketch above, which didn't pass one, is out of date). `config` is plain data: nothing is read from environment variables inside the package.

## Demo shop — `apps/demo-shop` **[built; needs deployed contracts for a real purchase]**

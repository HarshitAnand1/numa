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
`createOrder` returns a JSON-safe `OrderPayload`: `{ order{campaignId,merchant,creator,buyer,gross,orderId,deadline}, digest, authNonce, merchantSig, payoutSigner, router, chainId }`. In the *input*, `amount` is a decimal USDT string with at most 6 decimals (`"25.00"`); in the returned `order`, `gross` is the same value in base units (`"25000000"`). `order` is exactly the shape the relayer's `POST /relay` expects, so nothing needs renaming. Orders expire after `ttlSeconds` (default 900). `authNonce` is the `OrderCommitment`: the buyer must use it as the EIP-3009 nonce, which binds the payment to this exact order and split (ADR 0005). The signer key stays on the merchant's server.

After the buyer signs, build the relay body with the helper (it validates against the shared schema, so a mistake fails in the browser or merchant server, not at the relayer):
```ts
import { toRelayRequest } from "@numa/sdk-server";
const body = toRelayRequest(payload, { validAfter, validBefore, v, r, s }); // POST this to /relay
```

Notes: `merchant` (the campaign's merchant address) is distinct from the payout-signer key. `creator` and `buyer` are passed per order; direct sales without a creator are not supported by the current design. `OrderSigner` is the lower-level class (explicit campaign per call); the API's demo `POST /orders` uses it.

Merchants must also `USDT.approve(NumaRouter, …)` so refunds can be pulled from them (ADR 0001).

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
"Kiln & Co.", a deliberately unlike-numa store (`apps/demo-shop`, port 5174). It takes the campaign from `VITE_CAMPAIGN_ID` and the creator from `?creator=0x…` (as an attribution link would), embeds `<NumaCheckout>`, says plainly when contracts aren't deployed or no creator link was used, and keeps the widget mounted after payment so the receipt stays visible. It uses the API's demo `POST /orders`, so the API needs `MERCHANT_SIGNER_KEY` set to the campaign's payout signer. Not run against a deployed stack.

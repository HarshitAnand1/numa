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

## React: `@numa/sdk-react` **[built, unit-tested with a fake wallet; not run against a deployed router or a real wallet]**
```tsx
import { NumaCheckout } from "@numa/sdk-react";

<NumaCheckout
  orderUrl="/api/orders"        // the merchant's endpoint that returns a signed order (Numa.createOrder, or the demo POST /orders)
  relayUrl="/api"               // the Numa relayer API
  params={{ campaignId: "7", creator, amount: "25.00" }}   // extra fields for the merchant endpoint; the buyer address is added for you
  onPaid={(r) => console.log(r.explorerUrl)}
/>
```
What it does, in order: connects the wallet, POSTs `{...params, buyer}` to `orderUrl`, adds/switches to Whitechain Sepolia if needed, checks the buyer holds enough USDT, asks the wallet for **one EIP-712 signature** (an EIP-3009 `ReceiveWithAuthorization` with `to = router` and `nonce = authNonce`, so no gas and no transaction), POSTs the relay body to `{relayUrl}/relay`, and shows the explorer receipt. A relay timeout or duplicate is resolved by polling `GET /relay/:orderId` rather than reported as a failure. A reverted order is reported as "not charged".

Pieces: `runCheckout(config, onState)` (framework-free, all the logic), `useNumaCheckout(config)` (headless hook returning `{state, pay, reset, busy}` so you can build your own UI), `<NumaCheckout />` (button + error + receipt, `renderReceipt` to customise). Pass `provider` (any EIP-1193 provider, e.g. an embedded wallet) to avoid the injected wallet. Safety: it refuses an order whose buyer isn't the connected account, that has expired, or that fails schema validation; the nonce it signs is the merchant's `OrderCommitment`, which the relayer and router both re-derive and enforce.

Tests (`packages/sdk-react/tests`) run the whole flow against a fake wallet that really signs, a real `Numa` order signer and a relayer stand-in that verifies the buyer's signature the way the real relayer does. **Not verified:** a real browser wallet, the buyer's wallet UX, and anything against a deployed router.

## Demo shop: `apps/demo-shop` **[built; builds; not run against a deployed stack]**
A separate Vite app whose only numa code is the `<NumaCheckout />` above (about 20 lines, see `src/main.tsx`). `pnpm --filter @numa/demo-shop dev` serves it on :5174 and proxies `/api` to the API (`VITE_API_PROXY`, default `http://localhost:8787`). Set `VITE_CAMPAIGN_ID` (and optionally `VITE_CREATOR`, or open it with `?creator=0x…` as an attribution link would). It uses the API's demo `POST /orders`, so the API needs `MERCHANT_SIGNER_KEY` set to the campaign's payout signer.

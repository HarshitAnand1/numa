# Merchant SDK — **target design, not implemented**
Server (`@numa/sdk-server`): `new Numa({ campaignId, signerKey }).createOrder({ amount, orderId, creator })` → signed order. Today the equivalent logic is `apps/api/src/services/orders.ts` (`OrderService`).
React (`@numa/sdk-react`): `<NumaCheckout orderUrl="/api/order" onPaid={...} />` — fetches the signed order, has the buyer sign the USDT authorization (`receiveAuthTypedData` in `@numa/shared`), posts to `/relay`, returns the tx hash. Not built.
A separate `apps/demo-shop` will integrate it end to end.

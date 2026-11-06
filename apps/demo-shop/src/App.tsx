import { useMemo, useState } from "react";
import { NumaCheckout, type NumaConfig, type NumaPaid } from "@numa/sdk-react";
import { DEPLOYED_ADDRESSES, USDT_ADDRESS, WHITECHAIN_SEPOLIA_CHAIN_ID } from "@numa/shared";
import { isAddress, type Address } from "viem";

/**
 * Kiln & Co.: a pretend ceramics shop. It exists to show how little a merchant needs to accept
 * numa checkout: a campaign id, an order endpoint, and <NumaCheckout />. Everything else here is
 * ordinary shop UI. Testnet only: no mug will ever arrive.
 */

const PRICE = "24.00"; // USDT
const CAMPAIGN_ID = import.meta.env.VITE_CAMPAIGN_ID ?? "7";
const API = import.meta.env.VITE_API_URL ?? "/api";

const envAddr = (v: string | undefined): Address | undefined => (v && isAddress(v) ? (v as Address) : undefined);
const deployed = DEPLOYED_ADDRESSES[WHITECHAIN_SEPOLIA_CHAIN_ID];
const router = envAddr(import.meta.env.VITE_NUMA_ROUTER_ADDRESS) ?? deployed?.numaRouter;
const registry = envAddr(import.meta.env.VITE_CAMPAIGN_REGISTRY_ADDRESS) ?? deployed?.campaignRegistry;

const NUMA: NumaConfig | undefined =
  router && registry
    ? {
        chainId: WHITECHAIN_SEPOLIA_CHAIN_ID,
        router,
        registry,
        token: deployed?.usdt ?? USDT_ADDRESS,
        // numa's demo order service; a real merchant points this at their own endpoint
        orderUrl: `${API}/orders`,
        relayUrl: `${API}/relay`,
      }
    : undefined;

export default function App() {
  // The creator is whoever owns the attribution link the buyer arrived through: ?creator=0x…
  const creator = useMemo(() => {
    const c = new URLSearchParams(window.location.search).get("creator") ?? "";
    return isAddress(c) ? (c as Address) : undefined;
  }, []);
  const [paid, setPaid] = useState<NumaPaid | null>(null);

  return (
    <div className="shop">
      <header className="shop-head">
        <b className="shop-logo">Kiln &amp; Co.</b>
        <nav>
          <span>mugs</span>
          <span>bowls</span>
          <span>about the kiln</span>
        </nav>
        <small>demo store · testnet · nothing ships</small>
      </header>

      <main className="product">
        <div className="mug" role="img" aria-label="A speckled ash-glaze mug">
          <div className="mug-body">
            <i className="mug-handle" />
          </div>
          <span className="mug-shadow" />
        </div>

        <section className="details">
          <p className="eyebrow">small batch · No. 14</p>
          <h1>Ash Glaze Mug</h1>
          <p className="lede">
            Thrown by hand, fired twice, glazed with wood ash from the kiln itself. Each one comes out a
            little different, which we’re choosing to call character.
          </p>
          <dl>
            <div>
              <dt>Holds</dt>
              <dd>340 ml</dd>
            </div>
            <div>
              <dt>Dishwasher</dt>
              <dd>safe, but be kind</dd>
            </div>
            <div>
              <dt>Ships</dt>
              <dd>never (it’s a demo)</dd>
            </div>
          </dl>
          <p className="price">
            {PRICE} <small>USDT</small>
          </p>

          {paid && (
            <div className="thanks" role="status">
              <b>Thank you. The mug is yours (in spirit).</b>
              <p>
                Order <code>{paid.orderId.slice(0, 10)}…</code> settled on Whitechain
                {creator ? <> and the creator who sent you earned their commission</> : null}.
              </p>
            </div>
          )}
          {!NUMA ? (
            <p className="notice">Checkout isn’t available: the numa contracts aren’t deployed yet, so no payment can be taken.</p>
          ) : !creator ? (
            <p className="notice">
              This store sells through creators. Open it from a creator’s link (<code>?creator=0x…</code>) to buy.
            </p>
          ) : (
            <NumaCheckout config={NUMA} params={{ campaignId: CAMPAIGN_ID, creator, amount: PRICE }} onPaid={setPaid} />
          )}
        </section>
      </main>

      <footer className="shop-foot">
        <span>Payments by numa · one signature, no gas</span>
        <span>© Kiln &amp; Co., a figment of a hackathon</span>
      </footer>
    </div>
  );
}

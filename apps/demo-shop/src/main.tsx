import { createRoot } from "react-dom/client";
import { useState } from "react";
import { NumaCheckout } from "@numa/sdk-react";

// A merchant's store page. Everything numa needs is the <NumaCheckout /> below.
// VITE_CAMPAIGN_ID / VITE_CREATOR come from your deployment; the creator is whoever's attribution link brought the buyer here.
const CAMPAIGN_ID = import.meta.env.VITE_CAMPAIGN_ID ?? "1";
const CREATOR = new URLSearchParams(location.search).get("creator") ?? import.meta.env.VITE_CREATOR ?? "0x0000000000000000000000000000000000000000";
const PRICE = "25.00";

function Shop() {
  const [receipt, setReceipt] = useState<string>();
  return (
    <main style={{ font: "16px system-ui, sans-serif", maxWidth: 420, margin: "64px auto", padding: "0 16px" }}>
      <h1>Pixel Pro Headphones</h1>
      <p>Wireless headphones. ${PRICE} USDT. No gas token, no seed phrase screens beyond your wallet's own approval.</p>
      {receipt ? (
        <p>Thanks! Your receipt: <a href={receipt} target="_blank" rel="noreferrer">view on the explorer</a></p>
      ) : (
        <NumaCheckout
          orderUrl="/api/orders"
          relayUrl="/api"
          params={{ campaignId: CAMPAIGN_ID, creator: CREATOR, amount: PRICE }}
          label={`Pay $${PRICE} with USDT`}
          onPaid={(r) => setReceipt(r.explorerUrl)}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Shop />);

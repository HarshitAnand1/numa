import { useState } from "react";
import { parseUnits, type Address } from "viem";
import { API_BASE, api } from "../api/client";
import { shortAddress, txUrl } from "../api/format";
import { useLive } from "../api/useLive";
import { usdt2 } from "../verify/verifyInput";
import { ChainActionError, approveRefundsTx, readAllowance } from "../web3/chainActions";
import { TOKEN_ADDRESS } from "../web3/config";

const groupUsdt = (v: bigint) => `${(v / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(v % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;

/** Merchant must let the router pull refunds from their USDT (ADR 0001). Allowance is read from chain, never remembered. */
export function RefundApproval({ address, router }: { address: Address; router: Address | undefined }) {
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const allowance = useLive<bigint>(
    () => (router ? readAllowance({ token: TOKEN_ADDRESS, owner: address, spender: router }) : Promise.reject(new Error("no router"))),
    [address, router],
    { every: 20000, enabled: !!router },
  );
  let parsed: bigint | null = null;
  try {
    parsed = /^\d+(\.\d{1,6})?$/.test(amount) ? parseUnits(amount, 6) : null;
  } catch {
    parsed = null;
  }
  const have = allowance.data;
  const run = async () => {
    if (!router || parsed === null || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await approveRefundsTx({ token: TOKEN_ADDRESS, account: address, router, amount: parsed });
      setMsg({ kind: "ok", text: `Approved. Refunds can now be pulled from your wallet up to ${amount} USDT. Transaction ${shortAddress(r.txHash, 8, 6)}.` });
      setTimeout(allowance.reload, 2000);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ChainActionError ? e.message : "Something went wrong. Nothing changed." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="app-panel refund-approval">
      <div className="panel-head">
        <h3>refund allowance</h3>
        <span className="chain-label">● CHAIN</span>
      </div>
      <p className="panel-note">
        If a buyer is refunded, the router pulls the refund from <b>your</b> USDT. It can only do that if you approve it first. This sends no USDT now. Current allowance:{" "}
        <b>{!router ? "contracts not configured" : have === undefined ? (allowance.error ? "couldn’t read it" : "reading…") : `${groupUsdt(have)} USDT`}</b>
        {have !== undefined && have === 0n && (
          <>
            {" "}
            — <b>refunds will fail until you approve</b>.
          </>
        )}
      </p>
      <div className="link-builder">
        <label className={`ag-field light ${parsed === null ? "bad" : ""}`}>
          <span>approve up to (USDT)</span>
          <div>
            <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
            <i>USDT</i>
          </div>
          <small>{parsed === null ? "A number with at most 6 decimals." : "Set 0 to revoke."}</small>
        </label>
        <button className="hard-button" disabled={!router || parsed === null || busy} onClick={run}>
          {busy ? "CONFIRM IN WALLET…" : "APPROVE REFUNDS (WALLET)"}
        </button>
      </div>
      {msg && (
        <p className={`ag-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

/** The merchant's real ledger: settled orders rebuilt from chain by the API. */
export function MerchantOrders({ address }: { address: Address }) {
  const ledger = useLive((s) => api.merchantOrders(address, s), [address], { every: 20000 });
  const rows = ledger.data?.orders ?? [];
  const csv = `${API_BASE}/merchants/${address}/orders?format=csv`;
  return (
    <section className="app-panel merchant-tools">
      <div className="app-greeting">
        <span>MERCHANT / ORDERS</span>
        <h1>
          WHAT <em>SETTLED.</em>
        </h1>
      </div>
      <p className="panel-note">Read from Whitechain by the API, one row per settled order, with refunds and releases folded in.</p>
      {ledger.error && !ledger.data && (
        <p className="ag-msg err" role="alert">
          Couldn’t load orders. The API may be offline, or it may not scan this far back. Nothing is shown rather than guessing.
        </p>
      )}
      {ledger.loading && !ledger.data && !ledger.error && <p className="panel-note">Loading orders…</p>}
      {ledger.data && rows.length === 0 && <p className="panel-note">No settled orders for this wallet yet.</p>}
      {rows.length > 0 && (
        <>
          <p>
            <a className="outline-button" href={csv} download>
              DOWNLOAD CSV
            </a>
          </p>
          <div className="data-list">
            {rows.map((r) => (
              <div className="data-list-row" key={r.orderId}>
                <span>
                  <b>{usdt2(r.grossUsdt)} USDT</b>
                  <small>
                    campaign #{r.campaignId} · buyer {shortAddress(r.buyer)} · creator {shortAddress(r.creator)} · you net {usdt2(r.merchantNetAfterRefundsUsdt)}
                    {r.refundedUsdt !== "0.000000" && ` · refunded ${usdt2(r.refundedUsdt)}`}
                  </small>
                  <small>{new Date(r.paidAt).toUTCString()}</small>
                </span>
                <span className="status live">{r.status.replace(/_/g, " ").toUpperCase()}</span>
                <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer">
                  tx ↗
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import { ApiError, api } from "../api/client";
import { shortAddress, txUrl, addressUrl } from "../api/format";
import type { ApiReceipt } from "../api/types";
import { orderIdsInTx } from "../web3/chainActions";
import { ROUTER_ADDRESS } from "../web3/config";
import { parseVerifyInput, statusText, usdt2 } from "./verifyInput";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; receipt: ApiReceipt; via: "order" | "tx" }
  | { kind: "notfound"; text: string }
  | { kind: "error"; text: string };

/** Looks an order up from the router's own settlement record (via the API). Says "not found" rather than inventing a match. */
async function lookup(value: `0x${string}`): Promise<Result> {
  const asOrder = async () => {
    try {
      return await api.receipt(value);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  };
  try {
    const direct = await asOrder();
    if (direct) return { kind: "found", receipt: direct, via: "order" };
    // not an order id: maybe a transaction hash. Read it from the chain and see which orders it settled.
    if (!ROUTER_ADDRESS) return { kind: "notfound", text: "No settled order has this id. (Transaction-hash lookup needs the router address, which isn’t configured here.)" };
    let ids: `0x${string}`[] = [];
    try {
      ids = await orderIdsInTx(value, ROUTER_ADDRESS);
    } catch {
      return { kind: "notfound", text: "Nothing on Whitechain matches this as an order id or a transaction hash." };
    }
    if (ids.length === 0) return { kind: "notfound", text: "That transaction exists but the numa router did not settle an order in it." };
    const receipt = await api.receipt(ids[0]!);
    return { kind: "found", receipt, via: "tx" };
  } catch (e) {
    if (e instanceof ApiError && e.kind !== "http") return { kind: "error", text: "The numa API is unreachable, so the settlement record can’t be read right now. Nothing is claimed either way." };
    return { kind: "error", text: "Couldn’t verify this right now. Nothing is claimed either way." };
  }
}

export function Verify() {
  const [input, setInput] = useState("");
  const [res, setRes] = useState<Result>({ kind: "idle" });
  const parsed = parseVerifyInput(input);
  const go = async () => {
    if (parsed.kind !== "hash") return;
    setRes({ kind: "loading" });
    setRes(await lookup(parsed.value));
  };
  const r = res.kind === "found" ? res.receipt : null;
  return (
    <main className="page verify-page">
      <section className="verify-intro">
        <span>JUDGE TOOL / NO TRUST REQUIRED</span>
        <h1>
          DON’T TAKE
          <br />
          OUR WORD <em>FOR IT.</em>
        </h1>
        <p>Paste a numa order ID or a Whitechain transaction hash. We read the router’s own settlement record and show exactly what it says, or that it found nothing.</p>
      </section>
      <section className="verify-box">
        <label htmlFor="verify-input">ORDER ID OR TRANSACTION HASH</label>
        <div>
          <input
            id="verify-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setRes({ kind: "idle" });
            }}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="0x… (64 hex characters)"
            spellCheck={false}
            autoComplete="off"
          />
          <button disabled={parsed.kind !== "hash" || res.kind === "loading"} onClick={go}>
            {res.kind === "loading" ? "CHECKING…" : "VERIFY"}
          </button>
        </div>
        {input.trim() !== "" && parsed.kind === "bad" && <p role="status">{parsed.reason}</p>}
        <p>Money state comes from Whitechain. Arkiv indexing can lag behind, and this page doesn’t depend on it.</p>
      </section>
      {(res.kind === "notfound" || res.kind === "error") && (
        <section className="verify-result" role="alert">
          <div className="result-title">
            <div>
              <span>{res.kind === "notfound" ? "NO SETTLED ORDER FOUND" : "COULDN’T CHECK"}</span>
            </div>
          </div>
          <p>{res.text}</p>
        </section>
      )}
      {r && res.kind === "found" && (
        <section className="verify-result">
          <div className="result-title">
            <div>
              <span>SETTLED ON-CHAIN</span>
            </div>
            <span className="status live">{r.status.replace(/_/g, " ").toUpperCase()}</span>
          </div>
          <div className="verify-grid">
            <div>
              <small>ORDER</small>
              <code>{shortAddress(r.orderId, 10, 8)}</code>
              <span>{res.via === "tx" ? "found via transaction hash" : "found by order id"}</span>
            </div>
            <div>
              <small>GROSS</small>
              <b>{usdt2(r.grossUsdt)} USDT</b>
              <span>{new Date(r.paidAt).toUTCString()}</span>
            </div>
            <div>
              <small>MERCHANT NET</small>
              <b>{usdt2(r.merchantNetUsdt)} USDT</b>
              <a href={addressUrl(r.merchant)} target="_blank" rel="noreferrer">
                {shortAddress(r.merchant)} ↗
              </a>
            </div>
            <div>
              <small>CREATOR COMMISSION</small>
              <b>{usdt2(r.creatorCommissionUsdt)} USDT</b>
              <a href={addressUrl(r.creator)} target="_blank" rel="noreferrer">
                {shortAddress(r.creator)} ↗
              </a>
            </div>
            <div>
              <small>PROTOCOL FEE</small>
              <b>{usdt2(r.protocolFeeUsdt)} USDT</b>
              <span>to the numa router</span>
            </div>
            <div>
              <small>STILL HELD</small>
              <b>{usdt2(r.commissionStillHeldUsdt)} USDT</b>
              <span>{r.commissionReleased ? "released to the creator" : "until the refund window ends"}</span>
            </div>
          </div>
          <div className="agreement">
            <p>{statusText(r.status)}</p>
            {Number(r.refundedUsdt) > 0 && <p>Refunded to the buyer: {usdt2(r.refundedUsdt)} USDT.</p>}
            <p>
              Buyer: <a href={addressUrl(r.buyer)} target="_blank" rel="noreferrer">{shortAddress(r.buyer)} ↗</a>
              {r.txHash && r.explorerUrl ? (
                <>
                  {" "}
                  · <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer">payment transaction ↗</a>
                </>
              ) : (
                " · the payment transaction hash isn’t known to this API (it wasn’t relayed by it); the settlement itself is read from the router."
              )}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

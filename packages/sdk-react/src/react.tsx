import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Hex } from "viem";
import { CheckoutError, runCheckout, type CheckoutConfig, type CheckoutState } from "./core.js";

/** Headless hook: bring your own UI. `pay()` runs the whole flow and resolves with the transaction hash. */
export function useNumaCheckout(config: CheckoutConfig) {
  const [state, setState] = useState<CheckoutState>({ step: "idle" });
  const cfg = useRef(config);
  cfg.current = config;
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const pay = useCallback(async () => {
    if (busy.current) return undefined; // ignore double clicks
    busy.current = true;
    try {
      return await runCheckout(cfg.current, (s) => { if (alive.current) setState(s); });
    } catch (e) {
      if (e instanceof CheckoutError) return undefined; // already reflected in `state`
      throw e;
    } finally { busy.current = false; }
  }, []);
  const reset = useCallback(() => setState({ step: "idle" }), []);
  return { state, pay, reset, busy: state.step !== "idle" && state.step !== "paid" && state.step !== "error" };
}

const LABEL: Record<CheckoutState["step"], string> = {
  idle: "Pay with USDT", connecting: "Connecting wallet…", "switching-network": "Switching network…", "creating-order": "Preparing your order…",
  signing: "Approve in your wallet…", settling: "Completing payment…", paid: "Paid", error: "Try again",
};

export interface NumaCheckoutProps extends CheckoutConfig {
  /** Button text while idle. Default "Pay with USDT". */
  label?: string;
  className?: string;
  style?: CSSProperties;
  onPaid?: (r: { txHash: Hex; orderId: Hex; explorerUrl: string }) => void;
  onError?: (e: { code: string; message: string }) => void;
  /** Render your own receipt instead of the default link. */
  renderReceipt?: (r: { txHash: Hex; orderId: Hex; explorerUrl: string }) => ReactNode;
}

const base: CSSProperties = {
  font: "600 16px/1 system-ui, sans-serif", padding: "14px 22px", borderRadius: 10, border: 0, cursor: "pointer",
  background: "#111", color: "#fff", minWidth: 200,
};

/**
 * Drop-in checkout button. The buyer needs USDT and a wallet, no gas token:
 *   <NumaCheckout orderUrl="/api/order" relayUrl="https://relay.example/api" params={{ creator, amount: "25.00" }} onPaid={...} />
 */
export function NumaCheckout(props: NumaCheckoutProps) {
  const { label, className, style, onPaid, onError, renderReceipt, ...config } = props;
  const { state, pay, busy } = useNumaCheckout(config);
  const reported = useRef<string>("");
  useEffect(() => {
    if (state.step === "paid" && reported.current !== state.txHash) { reported.current = state.txHash; onPaid?.({ txHash: state.txHash, orderId: state.orderId, explorerUrl: state.explorerUrl }); }
    if (state.step === "error" && reported.current !== `e:${state.message}`) { reported.current = `e:${state.message}`; onError?.({ code: state.code, message: state.message }); }
  }, [state, onPaid, onError]);

  if (state.step === "paid") {
    const r = { txHash: state.txHash, orderId: state.orderId, explorerUrl: state.explorerUrl };
    return <div className={className} style={style} role="status">{renderReceipt ? renderReceipt(r) : <span>Payment complete. <a href={r.explorerUrl} target="_blank" rel="noreferrer">View receipt</a></span>}</div>;
  }
  return (
    <div className={className} style={style}>
      <button type="button" onClick={() => void pay()} disabled={busy} aria-busy={busy} style={{ ...base, opacity: busy ? 0.7 : 1 }}>
        {state.step === "idle" ? (label ?? LABEL.idle) : LABEL[state.step]}
      </button>
      {state.step === "error" && <p role="alert" style={{ color: "#b00020", font: "14px system-ui, sans-serif", margin: "8px 0 0" }}>{state.message}</p>}
    </div>
  );
}

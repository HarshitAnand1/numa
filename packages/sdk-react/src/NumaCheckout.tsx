import { useEffect, useRef, type CSSProperties } from "react";
import { whitechainSepolia } from "@numa/shared";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import type { NumaConfig } from "./config";
import type { CheckoutParams } from "./params";
import type { FailureInfo } from "./relayErrors";
import { useCheckout } from "./useCheckout";

export interface NumaPaid {
  txHash: string;
  blockNumber: string;
  orderId: string;
  /** gross amount in USDT base units (6 decimals) */
  gross: bigint;
}

export interface NumaCheckoutProps {
  config: NumaConfig;
  /** what the buyer is paying for: campaign, creator (owner of the attribution link) and amount */
  params: CheckoutParams;
  onPaid?: (paid: NumaPaid) => void;
  onFailed?: (failure: FailureInfo & { code: string }) => void;
  /** build an explorer link for the receipt (default: Whitechain Sepolia's explorer) */
  txUrl?: (hash: string) => string;
}

const defaultTxUrl = (hash: string) => `${whitechainSepolia.blockExplorers.default.url}/tx/${hash}`;

const s: Record<string, CSSProperties> = {
  box: { display: "grid", gap: 10, font: "inherit" },
  button: { padding: "12px 16px", font: "inherit", fontWeight: 700, cursor: "pointer", border: "1px solid currentColor", background: "transparent", color: "inherit" },
  note: { margin: 0, fontSize: 13, opacity: 0.8 },
  error: { margin: 0, padding: 10, border: "1px solid #ff2a1f", fontSize: 13 },
};

const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;

/**
 * Drop-in gasless USDT checkout. The buyer signs one authorization (no gas, not a transaction);
 * the relayer submits it. Needs a wagmi + react-query provider above it (see `NumaProvider`).
 * Restyle freely: every element has a `numa-*` class name and only minimal inline styles.
 *
 *   <NumaProvider>
 *     <NumaCheckout config={cfg} params={{ campaignId: "7", creator, amount: "25.00" }} onPaid={...} />
 *   </NumaProvider>
 */
export function NumaCheckout({ config, params, onPaid, onFailed, txUrl = defaultTxUrl }: NumaCheckoutProps) {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { state, pay, reset, busy } = useCheckout(params, config);
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (state.step === "settled" && state.verified && state.result && reported.current !== state.result.txHash) {
      reported.current = state.result.txHash;
      onPaid?.({ txHash: state.result.txHash, blockNumber: state.result.blockNumber, orderId: state.verified.order.orderId, gross: state.verified.order.gross });
    }
    if (state.step === "failed" && state.failure) onFailed?.(state.failure);
    // callbacks are intentionally not dependencies: a new function identity must not re-fire them
  }, [state.step]);

  const label: Record<string, string> = {
    ordering: "Preparing order…",
    verifying: "Checking the order on-chain…",
    signing: "Confirm in your wallet…",
    relaying: "Sending to Whitechain…",
  };

  if (state.step === "settled" && state.result) {
    return (
      <div className="numa-checkout numa-receipt" style={s.box}>
        <strong>Paid {params.amount} USDT</strong>
        <a href={txUrl(state.result.txHash)} target="_blank" rel="noopener noreferrer">
          {short(state.result.txHash)} ↗
        </a>
      </div>
    );
  }

  const ready = isConnected && chainId === config.chainId;
  return (
    <div className="numa-checkout" style={s.box}>
      {state.step === "failed" && state.failure && (
        <p className="numa-error" role="alert" style={s.error}>
          <strong>{state.failure.title}</strong> {state.failure.message}
        </p>
      )}
      {!isConnected ? (
        <button
          className="numa-button"
          style={s.button}
          disabled={isPending || !connectors[0]}
          onClick={() => connectors[0] && connect({ connector: connectors[0], chainId: config.chainId })}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
      ) : !ready ? (
        <button className="numa-button" style={s.button} disabled={switching} onClick={() => switchChain({ chainId: config.chainId })}>
          {switching ? "Switching…" : "Switch to Whitechain"}
        </button>
      ) : state.step === "failed" && state.failure && !state.failure.retry ? (
        <button className="numa-button" style={s.button} onClick={reset}>
          Start over
        </button>
      ) : (
        <button className="numa-button" style={s.button} disabled={busy} onClick={pay}>
          {busy ? label[state.step] : state.step === "failed" ? "Try again" : `Pay ${params.amount} USDT`}
        </button>
      )}
      <p className="numa-status" style={s.note}>
        One signature, no gas. Your wallet doesn’t need WBT.
      </p>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { addressUrl, shortAddress } from "../api/format";
import { CHAIN, CHAIN_ID } from "./config";

function WalletIcon() {
  return (
    <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" aria-hidden="true">
      <path d="M4 7h15v12H4zM4 7V5h12v2M15 12h4" />
    </svg>
  );
}

const hasInjectedWallet = () => typeof window !== "undefined" && "ethereum" in window;

/**
 * Connect / network / account control for the header.
 * Disconnected -> "connect"; wrong network -> "switch"; connected -> address with a small menu.
 */
export function WalletButton() {
  const { address, chainId, isConnected, status } = useAccount();
  const { connect, connectors, isPending, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open && !note) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setNote(null);
      }
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open, note]);

  const connecting = isPending || status === "connecting" || status === "reconnecting";

  if (!isConnected || !address) {
    return (
      <div className="wallet-wrap" ref={box}>
        <button
          className="wallet-button"
          disabled={connecting}
          onClick={() => {
            if (!hasInjectedWallet()) {
              setNote("No wallet found in this browser. Install MetaMask or Rabby, then reload.");
              return;
            }
            setNote(null);
            resetConnect();
            connect({ connector: connectors[0], chainId: CHAIN_ID });
          }}
        >
          <WalletIcon /> <span>{connecting ? "CONNECTING…" : "CONNECT WALLET"}</span>
        </button>
        {note && (
          <div className="wallet-menu" role="status">
            <p>{note}</p>
            <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
              get a wallet ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  if (chainId !== CHAIN_ID) {
    return (
      <div className="wallet-wrap" ref={box}>
        <button
          className="wallet-button wrong"
          disabled={switching}
          title={`Switch your wallet to ${CHAIN.name}`}
          onClick={() => switchChain({ chainId: CHAIN_ID })}
        >
          <WalletIcon /> <span>{switching ? "SWITCHING…" : "WRONG NETWORK · SWITCH"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-wrap" ref={box}>
      <button className="wallet-button connected" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <WalletIcon /> <span>{shortAddress(address, 6, 4)}</span>
      </button>
      {open && (
        <div className="wallet-menu">
          <code>{address}</code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(address);
              setOpen(false);
            }}
          >
            copy address
          </button>
          <a href={addressUrl(address)} target="_blank" rel="noopener noreferrer">
            view on explorer ↗
          </a>
          <button
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            disconnect
          </button>
        </div>
      )}
    </div>
  );
}

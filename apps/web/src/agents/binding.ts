import { isUserRejection } from "@numa/sdk-react";
import { numberToHex, type Address, type EIP1193Provider, type Hex } from "viem";
import type { AgentRole } from "@numa/shared";
import { CHAIN_ID } from "../web3/config";

/**
 * Binding an agent wallet to your identity is an Arkiv transaction signed by YOUR wallet, on
 * Arkiv's chain (Rabdi), paid in tGLM test gas. Revoking is another one (delete the entity).
 * `@numa/arkiv` (and the Arkiv SDK it wraps) is loaded only when this runs, so it stays out of the
 * main bundle.
 */

export type BindingErrorCode = "NO_WALLET" | "REJECTED" | "NO_GAS" | "NETWORK_SWITCH" | "FAILED";

export class BindingError extends Error {
  constructor(
    readonly code: BindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BindingError";
  }
}

export type BindStep = "arkiv-network" | "sign" | "back-to-whitechain";

const provider = (): EIP1193Provider => {
  const p = (typeof window !== "undefined" ? (window as { ethereum?: EIP1193Provider }).ethereum : undefined) ?? null;
  if (!p) throw new BindingError("NO_WALLET", "No wallet found in this browser.");
  return p;
};

type RpcError = { code?: number; message?: string };
const unknownChain = (e: unknown) => {
  const r = e as RpcError;
  return r?.code === 4902 || /unrecognized chain|not added|unknown chain|try adding the chain/i.test(r?.message ?? "");
};

async function switchTo(p: EIP1193Provider, chainId: number, addParams?: Record<string, unknown>) {
  const hex = numberToHex(chainId);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if (isUserRejection(e)) throw new BindingError("REJECTED", "You declined the network switch.");
    if (addParams && unknownChain(e)) {
      try {
        await p.request({ method: "wallet_addEthereumChain", params: [addParams as never] });
      } catch (e2) {
        if (isUserRejection(e2)) throw new BindingError("REJECTED", "You declined adding the Arkiv network.");
        throw new BindingError("NETWORK_SWITCH", "Couldn't add the Arkiv network to your wallet.");
      }
      return;
    }
    throw new BindingError("NETWORK_SWITCH", "Couldn't switch your wallet to the Arkiv network.");
  }
}

function classify(e: unknown): BindingError {
  if (e instanceof BindingError) return e;
  if (isUserRejection(e)) return new BindingError("REJECTED", "You declined the signature. Nothing was written.");
  const msg = (e as RpcError)?.message ?? "";
  if (/insufficient funds|insufficient tglm|fund the account|exceeds (the )?balance|gas required exceeds|cost exceeds/i.test(msg)) {
    return new BindingError("NO_GAS", "Not enough tGLM on Arkiv to pay for this. Get some from the Arkiv faucet.");
  }
  // keep the real cause visible to developers; the UI only shows the plain-language message
  console.error("[numa] agent binding failed:", e);
  return new BindingError("FAILED", "The Arkiv write failed. Nothing was bound. Try again in a moment.");
}

/** Run `action` with the wallet on Arkiv, then put it back on Whitechain (best effort). */
async function onArkiv<T>(onStep: (s: BindStep) => void, action: (arkiv: typeof import("@numa/arkiv"), p: EIP1193Provider) => Promise<T>): Promise<T> {
  const p = provider();
  try {
    const arkiv = await import("@numa/arkiv");
    onStep("arkiv-network");
    await switchTo(p, arkiv.RABDI_CHAIN_ID, arkiv.rabdiAddChainParams());
    onStep("sign");
    return await action(arkiv, p);
  } catch (e) {
    throw classify(e);
  } finally {
    onStep("back-to-whitechain");
    await switchTo(p, CHAIN_ID).catch(() => undefined);
  }
}

/** Authorize `agent` to negotiate for `address` in `role` (30 days). Returns the new binding's entity key. */
export function bindAgent(a: { address: Address; agent: Address; role: AgentRole; onStep?: (s: BindStep) => void }) {
  return onArkiv(a.onStep ?? (() => undefined), async (arkiv, p) => {
    const writer = arkiv.createArkivBrowserWriter({ provider: p, address: a.address });
    return arkiv.publishAgentBinding(writer, { agent: a.agent, role: a.role });
  });
}

/** Delete a binding you own. */
export function revokeBinding(a: { address: Address; entityKey: string; onStep?: (s: BindStep) => void }) {
  return onArkiv(a.onStep ?? (() => undefined), async (arkiv, p) => {
    const writer = arkiv.createArkivBrowserWriter({ provider: p, address: a.address });
    await writer.deleteEntity({ entityKey: a.entityKey as Hex });
  });
}

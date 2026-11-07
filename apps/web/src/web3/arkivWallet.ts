import { isUserRejection } from "@numa/sdk-react";
import { numberToHex, type Address, type EIP1193Provider, type Hex } from "viem";
import { CHAIN_ID } from "./config";

/**
 * Every Arkiv write the app makes (agent binding, profile, offer, link, campaign listing, decision)
 * is a transaction signed by the USER's wallet on Arkiv's chain (Rabdi), paid in tGLM test gas.
 * This module is the one place that handles it: add/switch the wallet to Arkiv, run the write, put the
 * wallet back on Whitechain, and turn failures into plain-language errors.
 * `@numa/arkiv` (and the Arkiv SDK under it) is loaded only when a write actually runs, so it stays
 * out of the main bundle.
 */

export type ArkivErrorCode = "NO_WALLET" | "REJECTED" | "NO_GAS" | "NETWORK_SWITCH" | "FAILED";

export class ArkivWriteError extends Error {
  constructor(
    readonly code: ArkivErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArkivWriteError";
  }
}

export type ArkivStep = "arkiv-network" | "sign" | "back-to-whitechain";
export type ArkivModule = typeof import("@numa/arkiv");

/** Loads `@numa/arkiv`. Tests replace it with a fake so the UI flows can run without a funded wallet. */
let loader: () => Promise<ArkivModule> = () => import("@numa/arkiv");
/** The lazily loaded Arkiv package (for public reads that need no wallet). */
export const loadArkiv = () => loader();

export function __setArkivLoaderForTests(l: (() => Promise<ArkivModule>) | null) {
  loader = l ?? (() => import("@numa/arkiv"));
}

export const getProvider = (): EIP1193Provider => {
  const p = (typeof window !== "undefined" ? (window as { ethereum?: EIP1193Provider }).ethereum : undefined) ?? null;
  if (!p) throw new ArkivWriteError("NO_WALLET", "No wallet found in this browser.");
  return p;
};

type RpcError = { code?: number; message?: string };
const unknownChain = (e: unknown) => {
  const r = e as RpcError;
  return r?.code === 4902 || /unrecognized chain|not added|unknown chain|try adding the chain/i.test(r?.message ?? "");
};

export async function switchTo(p: EIP1193Provider, chainId: number, addParams?: Record<string, unknown>) {
  const hex = numberToHex(chainId);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if (isUserRejection(e)) throw new ArkivWriteError("REJECTED", "You declined the network switch.");
    if (addParams && unknownChain(e)) {
      try {
        await p.request({ method: "wallet_addEthereumChain", params: [addParams as never] });
      } catch (e2) {
        if (isUserRejection(e2)) throw new ArkivWriteError("REJECTED", "You declined adding the Arkiv network.");
        throw new ArkivWriteError("NETWORK_SWITCH", "Couldn't add the Arkiv network to your wallet.");
      }
      return;
    }
    throw new ArkivWriteError("NETWORK_SWITCH", "Couldn't switch your wallet to the Arkiv network.");
  }
}

export function classifyArkivError(e: unknown): ArkivWriteError {
  if (e instanceof ArkivWriteError) return e;
  if (isUserRejection(e)) return new ArkivWriteError("REJECTED", "You declined the signature. Nothing was written.");
  const msg = (e as RpcError)?.message ?? "";
  if (/insufficient funds|insufficient tglm|fund the account|exceeds (the )?balance|gas required exceeds|cost exceeds/i.test(msg)) {
    return new ArkivWriteError("NO_GAS", "Not enough tGLM on Arkiv to pay for this. Get some from the Arkiv faucet.");
  }
  // keep the real cause visible to developers; the UI only shows the plain-language message
  console.error("[numa] arkiv write failed:", e);
  return new ArkivWriteError("FAILED", "The Arkiv write failed. Nothing was published. Try again in a moment.");
}

/** Run `action` with the wallet on Arkiv, then put it back on Whitechain (best effort). */
export async function onArkiv<T>(
  onStep: (s: ArkivStep) => void,
  action: (arkiv: ArkivModule, p: EIP1193Provider) => Promise<T>,
): Promise<T> {
  const p = getProvider();
  try {
    const arkiv = await loader();
    onStep("arkiv-network");
    await switchTo(p, arkiv.RABDI_CHAIN_ID, arkiv.rabdiAddChainParams());
    onStep("sign");
    return await action(arkiv, p);
  } catch (e) {
    throw classifyArkivError(e);
  } finally {
    onStep("back-to-whitechain");
    await switchTo(p, CHAIN_ID).catch(() => undefined);
  }
}

export const STEP_TEXT: Record<ArkivStep, string> = {
  "arkiv-network": "Switching your wallet to the Arkiv network…",
  sign: "Confirm in your wallet (costs a little tGLM)…",
  "back-to-whitechain": "Switching back to Whitechain…",
};

/** A writer for `address` bound to the user's wallet. */
export const writerFor = (arkiv: ArkivModule, p: EIP1193Provider, address: Address) =>
  arkiv.createArkivBrowserWriter({ provider: p, address });

export type { Address, Hex };

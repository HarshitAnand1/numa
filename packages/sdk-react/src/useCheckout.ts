import { useCallback, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain } from "wagmi";
import { CheckoutApiError, createOrder, relayOrder } from "./checkoutApi";
import type { NumaConfig } from "./config";
import type { CheckoutParams } from "./params";
import { WALLET_REJECTED, describeRelayFailure, describeSigningFailure, type FailureInfo } from "./relayErrors";
import {
  SigningError,
  buildAuthTypedData,
  readChainTerms,
  toRelayBody,
  verifyOrderPayload,
  type VerifiedOrder,
} from "./signing";

export type CheckoutStep = "idle" | "ordering" | "verifying" | "signing" | "relaying" | "settled" | "failed";

export interface CheckoutState {
  step: CheckoutStep;
  /** set while signing/relaying/settled: the order the buyer was shown, as verified against the chain */
  verified?: VerifiedOrder;
  failure?: FailureInfo & { code: string };
  result?: { txHash: string; blockNumber: string };
}

/** Wallets reject with EIP-1193 code 4001 / UserRejectedRequestError; wagmi wraps it, so look through causes. */
export function isUserRejection(e: unknown): boolean {
  for (let cur = e as { name?: string; code?: number; message?: string; cause?: unknown } | undefined, i = 0; cur && i < 5; i++) {
    if (cur.code === 4001 || cur.name === "UserRejectedRequestError") return true;
    if (typeof cur.message === "string" && /user (rejected|denied)|rejected the request/i.test(cur.message)) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

/**
 * One payment, start to finish:
 *   wallet on Whitechain -> POST /orders -> verify the order against the chain -> check USDT balance
 *   -> buyer signs the EIP-3009 authorization (no gas, not a transaction) -> POST /relay -> settled.
 * The buyer is only asked to sign after the server's order has been checked; nothing is signed
 * if any check fails. A guard prevents a second submission while one is in flight.
 */
export function useCheckout(params: CheckoutParams | undefined, cfg: NumaConfig | undefined) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: cfg?.chainId });
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [state, setState] = useState<CheckoutState>({ step: "idle" });
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    if (!inFlight.current) setState({ step: "idle" });
  }, []);

  const pay = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    let sent = false; // once /relay has been called, the outcome of a failure can be unknown
    try {
      if (!cfg || !params || !address || !publicClient) {
        throw new SigningError("CONTRACTS_UNAVAILABLE", "Checkout isn't ready: connect a wallet and make sure the contracts are configured.");
      }
      if (chainId !== cfg.chainId) await switchChainAsync({ chainId: cfg.chainId });

      setState({ step: "ordering" });
      const payload = await createOrder(cfg.orderUrl, { campaignId: params.campaignId, creator: params.creator, buyer: address, amount: params.amount });

      setState({ step: "verifying" });
      const terms = await readChainTerms({
        client: publicClient,
        registry: cfg.registry,
        router: cfg.router,
        campaignId: BigInt(params.campaignId),
        creator: params.creator,
      });
      const verified = await verifyOrderPayload({
        payload,
        expected: { campaignId: params.campaignId, creator: params.creator, buyer: address, amount: params.amount },
        terms,
        router: cfg.router,
        chainId: cfg.chainId,
      });

      const balance = await publicClient
        .readContract({ address: cfg.token, abi: erc20Abi, functionName: "balanceOf", args: [address] })
        .catch(() => undefined);
      if (balance !== undefined && balance < verified.order.gross) {
        throw new SigningError("INSUFFICIENT_USDT", "Not enough USDT.");
      }

      setState({ step: "signing", verified });
      const signature = await signTypedDataAsync(buildAuthTypedData(verified, cfg.router, cfg.chainId, cfg.token));

      setState({ step: "relaying", verified });
      sent = true;
      const res = await relayOrder(cfg.relayUrl, toRelayBody(verified, signature));
      setState({ step: "settled", verified, result: { txHash: res.txHash, blockNumber: res.blockNumber } });
    } catch (e) {
      let failure: FailureInfo & { code: string };
      if (isUserRejection(e)) failure = { ...WALLET_REJECTED, code: "USER_REJECTED" };
      else if (e instanceof SigningError) failure = { ...describeSigningFailure(e.code), code: e.code };
      else if (e instanceof CheckoutApiError) {
        const info = describeRelayFailure(e.code);
        // If the request never produced a clean answer after we sent the signed payment, assume nothing.
        failure = { ...info, code: e.code, ...(sent && e.code.startsWith("HTTP_") ? { moneyMoved: "unknown" as const, retry: false } : {}) };
      } else failure = { ...describeRelayFailure("INTERNAL"), code: "INTERNAL" };
      setState((s) => ({ step: "failed", verified: s.verified, failure }));
    } finally {
      inFlight.current = false;
    }
  }, [cfg, params, address, chainId, publicClient, signTypedDataAsync, switchChainAsync]);

  return { state, pay, reset, busy: ["ordering", "verifying", "signing", "relaying"].includes(state.step) };
}

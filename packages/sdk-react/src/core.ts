import { createPublicClient, createWalletClient, custom, getAddress, parseAbi, parseSignature, type Address, type EIP1193Provider, type Hex } from "viem";
import { z } from "zod";
import { receiveAuthTypedData, toRelayRequest, whitechainSepolia, USDT_ADDRESS } from "@numa/shared";

/** Everything a checkout can be in. The UI renders from this; nothing else is needed to show progress. */
export type CheckoutState =
  | { step: "idle" }
  | { step: "connecting" }
  | { step: "switching-network" }
  | { step: "creating-order" }
  | { step: "signing" }
  | { step: "settling" }
  | { step: "paid"; txHash: Hex; orderId: Hex; explorerUrl: string }
  | { step: "error"; code: CheckoutErrorCode; message: string };

export type CheckoutErrorCode =
  | "NO_WALLET" | "USER_REJECTED" | "WRONG_NETWORK" | "ORDER_FAILED" | "BAD_ORDER" | "INSUFFICIENT_USDT"
  | "RELAY_REJECTED" | "SETTLEMENT_FAILED" | "TIMEOUT";

export class CheckoutError extends Error {
  constructor(readonly code: CheckoutErrorCode, message: string) { super(message); this.name = "CheckoutError"; }
}

export interface CheckoutConfig {
  /** Merchant endpoint. Called with POST and a JSON body `{ ...params, buyer }`; must return an order payload (see `@numa/sdk-server` `Numa.createOrder`). */
  orderUrl: string;
  /** Base URL of the Numa relayer API, e.g. "/api". The checkout calls `POST {relayUrl}/relay` and `GET {relayUrl}/relay/:orderId`. */
  relayUrl: string;
  /** Extra fields the merchant's endpoint needs (for example `{ creator, amount }`). The buyer address is added for you. */
  params?: Record<string, unknown>;
  /** An EIP-1193 wallet. Defaults to `window.ethereum`. Pass an embedded-wallet provider here to hide the wallet UI entirely. */
  provider?: EIP1193Provider;
  /** Authorization lifetime in seconds (capped by the order deadline). Default 600. */
  validitySeconds?: number;
  /** Check the buyer holds enough USDT before asking for a signature. Default true. */
  checkBalance?: boolean;
  pollMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Override the sleep used between polls (tests). */
  sleep?: (ms: number) => Promise<void>;
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v as Hex);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uintString = z.string().regex(/^\d+$/);
const payloadSchema = z.object({
  order: z.object({ campaignId: uintString, merchant: addressSchema, creator: addressSchema, buyer: addressSchema, gross: uintString, orderId: hex32, deadline: uintString }),
  authNonce: hex32,
  merchantSig: z.string().regex(/^0x[0-9a-fA-F]+$/),
  router: addressSchema,
  chainId: z.number().int().positive(),
});
export type CheckoutOrder = z.output<typeof payloadSchema>;

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

function injected(): EIP1193Provider | undefined {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum;
}

const isRejection = (e: unknown) => {
  const x = e as { code?: number; name?: string; cause?: { code?: number } };
  return x?.code === 4001 || x?.cause?.code === 4001 || x?.name === "UserRejectedRequestError";
};

/** Ensures the wallet is on Whitechain Sepolia, adding the network if it does not know it. */
export async function ensureNetwork(provider: EIP1193Provider, chainId: number): Promise<boolean> {
  const current = Number(BigInt((await provider.request({ method: "eth_chainId" })) as string));
  if (current === chainId) return false;
  const hexId = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (isRejection(e)) throw new CheckoutError("USER_REJECTED", "Network switch was cancelled.");
    if (code !== 4902 || chainId !== whitechainSepolia.id) throw new CheckoutError("WRONG_NETWORK", "Please switch your wallet to Whitechain Sepolia.");
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexId, chainName: whitechainSepolia.name, nativeCurrency: whitechainSepolia.nativeCurrency,
        rpcUrls: [...whitechainSepolia.rpcUrls.default.http], blockExplorerUrls: [whitechainSepolia.blockExplorers.default.url],
      }],
    });
  }
  return true;
}

/**
 * Runs one gasless checkout: connect, create the merchant-signed order, have the buyer sign an EIP-3009
 * authorization (no gas, no transaction), hand it to the relayer, wait for settlement.
 * The buyer's nonce is the order commitment returned by the merchant; the relayer and the router both
 * re-derive and enforce it, so this client cannot be tricked into signing something that pays anyone else.
 */
export async function runCheckout(cfg: CheckoutConfig, onState: (s: CheckoutState) => void = () => {}): Promise<{ txHash: Hex; orderId: Hex }> {
  const f = cfg.fetch ?? fetch;
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fail = (code: CheckoutErrorCode, message: string): never => { onState({ step: "error", code, message }); throw new CheckoutError(code, message); };
  try {
    const provider = cfg.provider ?? injected();
    if (!provider) return fail("NO_WALLET", "No wallet found. Install or open a wallet to pay.");

    onState({ step: "connecting" });
    let accounts: string[];
    try { accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[]; }
    catch (e) { return isRejection(e) ? fail("USER_REJECTED", "Wallet connection was cancelled.") : fail("NO_WALLET", "Could not connect to the wallet."); }
    if (!accounts[0]) return fail("NO_WALLET", "The wallet returned no account.");
    const buyer = getAddress(accounts[0]);

    // 1. merchant-signed order for this buyer
    onState({ step: "creating-order" });
    let order: CheckoutOrder;
    try {
      const res = await f(cfg.orderUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...cfg.params, buyer }) });
      if (!res.ok) return fail("ORDER_FAILED", `The store could not create the order (${res.status}).`);
      const parsed = payloadSchema.safeParse(await res.json());
      if (!parsed.success) return fail("BAD_ORDER", "The store returned an invalid order.");
      order = parsed.data;
    } catch (e) {
      if (e instanceof CheckoutError) throw e;
      return fail("ORDER_FAILED", "Could not reach the store to create the order.");
    }
    if (order.order.buyer.toLowerCase() !== buyer.toLowerCase()) return fail("BAD_ORDER", "The order is for a different buyer.");
    const gross = BigInt(order.order.gross);
    const deadline = BigInt(order.order.deadline);
    if (deadline <= BigInt(now())) return fail("BAD_ORDER", "The order has already expired.");

    onState({ step: "switching-network" });
    await ensureNetwork(provider, order.chainId);

    if (cfg.checkBalance !== false) {
      try {
        const pc = createPublicClient({ chain: whitechainSepolia, transport: custom(provider) });
        const balance = await pc.readContract({ address: USDT_ADDRESS, abi: erc20, functionName: "balanceOf", args: [buyer] });
        if (balance < gross) return fail("INSUFFICIENT_USDT", "Your wallet does not hold enough USDT for this payment.");
      } catch (e) { if (e instanceof CheckoutError) throw e; /* a failed balance read must not block paying; the relayer rejects an underfunded payment */ }
    }

    // 2. buyer signs the gasless authorization; nonce = the order commitment
    onState({ step: "signing" });
    const validAfter = 0n;
    const validBefore = BigInt(Math.min(Number(deadline), now() + (cfg.validitySeconds ?? 600)));
    const typed = receiveAuthTypedData({ from: buyer, router: getAddress(order.router), value: gross, validAfter, validBefore, nonce: order.authNonce as Hex }, order.chainId);
    let signature: Hex;
    try {
      const wallet = createWalletClient({ account: buyer, chain: whitechainSepolia, transport: custom(provider) });
      signature = await wallet.signTypedData(typed);
    } catch (e) { return isRejection(e) ? fail("USER_REJECTED", "Payment was cancelled.") : fail("NO_WALLET", "The wallet could not sign the payment."); }
    const sig = parseSignature(signature);
    const v = (sig.v !== undefined ? Number(sig.v) : 27 + sig.yParity) as 27 | 28;

    // 3. relayer submits it and pays the gas
    onState({ step: "settling" });
    const body = toRelayRequest(
      { order: order.order, merchantSig: order.merchantSig as Hex },
      { validAfter: validAfter.toString(), validBefore: validBefore.toString(), v, r: sig.r, s: sig.s },
    );
    const relay = (cfg.relayUrl.replace(/\/$/, ""));
    const explorer = (tx: Hex) => `${whitechainSepolia.blockExplorers.default.url}/tx/${tx}`;
    const done = (txHash: Hex) => { onState({ step: "paid", txHash, orderId: order.order.orderId, explorerUrl: explorer(txHash) }); return { txHash, orderId: order.order.orderId }; };

    let outcome: { status?: string; txHash?: Hex; error?: string; message?: string } = {};
    let httpStatus = 0;
    try {
      const res = await f(`${relay}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) });
      httpStatus = res.status;
      outcome = (await res.json()) as typeof outcome;
    } catch { /* network error: the relayer may still have sent it; fall through to polling */ httpStatus = 0; }
    if (outcome.status === "settled" && outcome.txHash) return done(outcome.txHash);
    // A timeout or duplicate means the transaction may exist: ask the relayer instead of failing.
    const uncertain = httpStatus === 0 || outcome.error === "TX_TIMEOUT" || outcome.error === "DUPLICATE";
    if (!uncertain) return fail("RELAY_REJECTED", outcome.message ?? outcome.error ?? "The payment was rejected.");

    const limit = now() + Math.ceil((cfg.timeoutMs ?? 120_000) / 1000);
    while (now() < limit) {
      await sleep(cfg.pollMs ?? 2000);
      let status: { status?: string; txHash?: Hex } | undefined;
      try {
        const r = await f(`${relay}/relay/${order.order.orderId}`);
        if (r.ok) status = (await r.json()) as typeof status;
      } catch { /* keep polling */ }
      // Decide outside the try: a terminal result must never be swallowed by the network-error handler above.
      if (status?.status === "settled" && status.txHash) return done(status.txHash);
      if (status?.status === "reverted") return fail("SETTLEMENT_FAILED", "The payment did not settle. You have not been charged; you can try again.");
    }
    return fail("TIMEOUT", "Still waiting for the payment to settle. Check the order status before paying again.");
  } catch (e) {
    if (e instanceof CheckoutError) throw e;
    const message = e instanceof Error ? e.message : "Unexpected error";
    onState({ step: "error", code: "SETTLEMENT_FAILED", message });
    throw new CheckoutError("SETTLEMENT_FAILED", message);
  }
}

export type { Address };

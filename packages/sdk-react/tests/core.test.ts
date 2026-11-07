import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, recoverTypedDataAddress, type Address, type EIP1193Provider, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Numa } from "@numa/sdk-server";
import { computeOrderCommitment, receiveAuthTypedData, relayRequest } from "@numa/shared";
import { CheckoutError, runCheckout, type CheckoutConfig, type CheckoutState } from "../src/core.js";

const router = "0x1111111111111111111111111111111111111111" as Address;
const merchant = "0x6666666666666666666666666666666666666666" as Address;
const creator = "0x2222222222222222222222222222222222222222" as Address;
const TX = ("0x" + "ab".repeat(32)) as Hex;
const CHAIN = 1874;

interface WalletOpts { chainId?: number; unknownChain?: boolean; balance?: bigint; rejectSign?: boolean; rejectConnect?: boolean }
function fakeWallet(opts: WalletOpts = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  let chainId = opts.chainId ?? CHAIN;
  const calls: string[] = [];
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push(method);
      switch (method) {
        case "eth_requestAccounts": if (opts.rejectConnect) throw Object.assign(new Error("no"), { code: 4001 }); return [account.address];
        case "eth_accounts": return [account.address];
        case "eth_chainId": return `0x${chainId.toString(16)}`;
        case "wallet_switchEthereumChain":
          if (opts.unknownChain && !calls.includes("wallet_addEthereumChain")) throw Object.assign(new Error("unknown chain"), { code: 4902 });
          chainId = Number(BigInt((params![0] as { chainId: string }).chainId)); return null;
        case "wallet_addEthereumChain": chainId = Number(BigInt((params![0] as { chainId: string }).chainId)); return null;
        case "eth_call": return encodeAbiParameters([{ type: "uint256" }], [opts.balance ?? 1_000_000_000n]);
        case "eth_signTypedData_v4": {
          if (opts.rejectSign) throw Object.assign(new Error("denied"), { code: 4001 });
          const t = JSON.parse(params![1] as string) as { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
          const { EIP712Domain: _d, ...types } = t.types;
          const message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, types[t.primaryType]!.find((f) => f.name === k)!.type.startsWith("uint") ? BigInt(v as string) : v]));
          return account.signTypedData({ domain: t.domain as never, types, primaryType: t.primaryType, message });
        }
        default: throw new Error(`unexpected ${method}`);
      }
    },
  } as unknown as EIP1193Provider;
  return { account, provider, calls, chain: () => chainId };
}

/** A merchant order endpoint plus a relayer that verifies the buyer's authorization exactly as the real relayer does. */
function backend(over: { relay?: (body: unknown) => Promise<Response> | Response; orderStatus?: number; orderBody?: (b: Record<string, unknown>) => unknown; poll?: () => Response } = {}) {
  const numa = new Numa({ campaignId: 7, merchant, signerKey: generatePrivateKey(), router, commissionBps: 1000, feeBps: 50 });
  const seen: { relay: unknown[]; orderReq: Record<string, unknown>[] } = { relay: [], orderReq: [] };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/order") {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      seen.orderReq.push(body);
      if (over.orderStatus) return json({ error: "no" }, over.orderStatus);
      const payload = await numa.createOrder({ amount: "25.00", creator, buyer: body.buyer as Address });
      return json(over.orderBody ? over.orderBody(payload as never) : payload);
    }
    if (url === "/api/relay" && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      seen.relay.push(body);
      if (over.relay) return over.relay(body);
      const req = relayRequest.parse(body);
      const nonce = computeOrderCommitment({ ...req.order, commissionBps: 1000n, feeBps: 50n }, CHAIN, router);
      const typed = receiveAuthTypedData({ from: req.order.buyer, router, value: req.order.gross, validAfter: req.auth.validAfter, validBefore: req.auth.validBefore, nonce }, CHAIN);
      const sig = (`0x${req.auth.r.slice(2)}${req.auth.s.slice(2)}${req.auth.v.toString(16)}`) as Hex;
      const signer = await recoverTypedDataAddress({ ...typed, signature: sig });
      if (signer.toLowerCase() !== req.order.buyer.toLowerCase()) return json({ error: "BAD_BUYER_AUTH", message: "signature does not match" }, 422);
      return json({ status: "settled", txHash: TX, blockNumber: "10" });
    }
    if (url.startsWith("/api/relay/")) return over.poll ? over.poll() : json({ status: "settled", txHash: TX });
    throw new Error(`unexpected fetch ${url}`);
  });
  return { fetchFn, seen };
}

const base = (w: ReturnType<typeof fakeWallet>, b: ReturnType<typeof backend>, more: Partial<CheckoutConfig> = {}): CheckoutConfig => ({
  orderUrl: "/order", relayUrl: "/api", params: { creator, amount: "25.00" }, provider: w.provider, fetch: b.fetchFn as never, sleep: async () => {}, ...more,
});

describe("gasless checkout core", () => {
  it("pays end to end: the signature it produces passes the relayer's own verification, with no gas transaction", async () => {
    const w = fakeWallet(), b = backend();
    const states: CheckoutState["step"][] = [];
    const r = await runCheckout(base(w, b), (s) => states.push(s.step));
    expect(r.txHash).toBe(TX);
    expect(states).toEqual(["connecting", "creating-order", "switching-network", "signing", "settling", "paid"]);
    expect(b.seen.orderReq[0]).toMatchObject({ creator, amount: "25.00", buyer: w.account.address }); // buyer address is added for the merchant
    expect(w.calls).not.toContain("eth_sendTransaction"); // the buyer never sends a transaction, so never pays gas
  });

  it("adds Whitechain Sepolia when the wallet doesn't know it, then continues", async () => {
    const w = fakeWallet({ chainId: 1, unknownChain: true }), b = backend();
    await runCheckout(base(w, b));
    expect(w.calls).toEqual(expect.arrayContaining(["wallet_switchEthereumChain", "wallet_addEthereumChain"]));
    expect(w.chain()).toBe(1874);
  });

  it("stops before signing when the buyer lacks USDT", async () => {
    const w = fakeWallet({ balance: 1n }), b = backend();
    await expect(runCheckout(base(w, b))).rejects.toMatchObject({ code: "INSUFFICIENT_USDT" });
    expect(w.calls).not.toContain("eth_signTypedData_v4");
    expect(b.seen.relay).toHaveLength(0);
  });

  it("maps a wallet rejection to a friendly cancel, with nothing sent to the relayer", async () => {
    const w = fakeWallet({ rejectSign: true }), b = backend();
    await expect(runCheckout(base(w, b))).rejects.toMatchObject({ code: "USER_REJECTED" });
    expect(b.seen.relay).toHaveLength(0);
    await expect(runCheckout(base(fakeWallet({ rejectConnect: true }), backend()))).rejects.toMatchObject({ code: "USER_REJECTED" });
  });

  it("refuses an order for a different buyer, an expired order, and a malformed order", async () => {
    const other = "0x3333333333333333333333333333333333333333";
    await expect(runCheckout(base(fakeWallet(), backend({ orderBody: (p) => ({ ...(p as object), order: { ...(p as { order: object }).order, buyer: other } }) })))).rejects.toMatchObject({ code: "BAD_ORDER" });
    await expect(runCheckout(base(fakeWallet(), backend({ orderBody: (p) => ({ ...(p as object), order: { ...(p as { order: object }).order, deadline: "1" } }) })))).rejects.toMatchObject({ code: "BAD_ORDER" });
    await expect(runCheckout(base(fakeWallet(), backend({ orderBody: () => ({ nope: true }) })))).rejects.toMatchObject({ code: "BAD_ORDER" });
    await expect(runCheckout(base(fakeWallet(), backend({ orderStatus: 500 })))).rejects.toMatchObject({ code: "ORDER_FAILED" });
  });

  it("reports a relayer rejection with its message", async () => {
    const b = backend({ relay: () => new Response(JSON.stringify({ error: "DAILY_CAP_EXCEEDED", message: "cap" }), { status: 422 }) });
    await expect(runCheckout(base(fakeWallet(), b))).rejects.toMatchObject({ code: "RELAY_REJECTED", message: "cap" });
  });

  it("a relay timeout is not a failure: it polls and finishes when the order settles", async () => {
    let polls = 0;
    const b = backend({
      relay: () => new Response(JSON.stringify({ error: "TX_TIMEOUT", message: "slow" }), { status: 422 }),
      poll: () => new Response(JSON.stringify(++polls < 3 ? { status: "sent" } : { status: "settled", txHash: TX }), { status: 200 }),
    });
    const r = await runCheckout(base(fakeWallet(), b));
    expect(r.txHash).toBe(TX);
    expect(polls).toBe(3);
  });

  it("a duplicate is resolved from the relayer, and a reverted order is reported as not charged", async () => {
    const dup = backend({ relay: () => new Response(JSON.stringify({ error: "DUPLICATE" }), { status: 409 }) });
    expect((await runCheckout(base(fakeWallet(), dup))).txHash).toBe(TX);
    const rev = backend({ relay: () => new Response(JSON.stringify({ error: "TX_TIMEOUT" }), { status: 422 }), poll: () => new Response(JSON.stringify({ status: "reverted" })) });
    await expect(runCheckout(base(fakeWallet(), rev))).rejects.toMatchObject({ code: "SETTLEMENT_FAILED" });
  });

  it("times out politely if the order never settles", async () => {
    let t = Math.floor(Date.now() / 1000);
    const b = backend({ relay: () => new Response(JSON.stringify({ error: "TX_TIMEOUT" }), { status: 422 }), poll: () => new Response(JSON.stringify({ status: "sent" })) });
    await expect(runCheckout(base(fakeWallet(), b, { now: () => t, sleep: async () => { t += 30; }, timeoutMs: 60_000 }))).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("reports NO_WALLET when nothing is injected", async () => {
    await expect(runCheckout({ orderUrl: "/order", relayUrl: "/api" })).rejects.toBeInstanceOf(CheckoutError);
  });
});

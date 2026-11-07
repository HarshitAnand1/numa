import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  computeOrderCommitment,
  orderCommitmentFromOrder,
  orderTypedData,
  receiveAuthTypedData,
  relayRequest,
  createOrderRequest,
  type Order,
} from "@numa/shared";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CheckoutApiError, createOrder, relayOrder } from "../src/checkoutApi";
import { parseCheckoutParams } from "../src/params";
import { RELAYER_ERROR_CODES, describeRelayFailure, describeSigningFailure } from "../src/relayErrors";
import {
  SigningError,
  authorizationWindow,
  buildAuthTypedData,
  parseUsdtAmount,
  readChainTerms,
  splitAmounts,
  splitSignature,
  toRelayBody,
  verifyOrderPayload,
  type ChainTerms,
  type OrderPayload,
} from "../src/signing";

// Test-only keys (never used anywhere real).
const buyer = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
const creator = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const merchant = privateKeyToAccount("0x3333333333333333333333333333333333333333333333333333333333333333");
const payoutSigner = privateKeyToAccount("0x4444444444444444444444444444444444444444444444444444444444444444");
const stranger = privateKeyToAccount("0x5555555555555555555555555555555555555555555555555555555555555555");

const CHAIN_ID = 1874;
const ROUTER: Address = "0x00000000000000000000000000000000000a11ce";
const TOKEN: Address = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const NOW = 1_800_000_000;
const COMMISSION_BPS = 1800n;
const FEE_BPS = 100n;

const terms: ChainTerms = {
  merchant: merchant.address,
  payoutSigner: payoutSigner.address,
  commissionBps: COMMISSION_BPS,
  feeBps: FEE_BPS,
  settleable: true,
  creatorApproved: true,
};

const expected = { campaignId: "7", creator: creator.address, buyer: buyer.address, amount: "25.00" };

/** What an honest order service would return. */
async function honestPayload(over: Partial<Order> = {}, signer = payoutSigner): Promise<OrderPayload> {
  const order: Order = {
    campaignId: 7n,
    merchant: merchant.address,
    creator: creator.address,
    buyer: buyer.address,
    gross: 25_000_000n,
    orderId: `0x${"ab".repeat(32)}`,
    deadline: BigInt(NOW + 900),
    ...over,
  };
  const merchantSig = await signer.signTypedData(orderTypedData(order, CHAIN_ID, ROUTER));
  const authNonce = computeOrderCommitment(orderCommitmentFromOrder(order, COMMISSION_BPS, FEE_BPS), CHAIN_ID, ROUTER);
  return {
    order: {
      campaignId: order.campaignId.toString(),
      merchant: order.merchant,
      creator: order.creator,
      buyer: order.buyer,
      gross: order.gross.toString(),
      orderId: order.orderId,
      deadline: order.deadline.toString(),
    },
    authNonce,
    merchantSig,
  };
}

const verify = (payload: OrderPayload, over: { expected?: Partial<typeof expected>; terms?: Partial<ChainTerms>; now?: number } = {}) =>
  verifyOrderPayload({
    payload,
    expected: { ...expected, ...over.expected },
    terms: { ...terms, ...over.terms },
    router: ROUTER,
    chainId: CHAIN_ID,
    now: over.now ?? NOW,
  });

const rejects = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  expect(err).toBeInstanceOf(SigningError);
  expect((err as SigningError).code).toBe(code);
};

describe("parseUsdtAmount", () => {
  it("parses to 6-decimal base units", () => {
    expect(parseUsdtAmount("25")).toBe(25_000_000n);
    expect(parseUsdtAmount("25.5")).toBe(25_500_000n);
    expect(parseUsdtAmount("0.000001")).toBe(1n);
    expect(parseUsdtAmount("1234567.123456")).toBe(1_234_567_123_456n);
  });
  it("rejects anything that is not a positive amount with at most 6 decimals", () => {
    for (const bad of ["", "0", "0.000000", "1.1234567", "-1", "abc", "1e3", " 5", "5.", ".5", "1,5"]) {
      expect(() => parseUsdtAmount(bad), JSON.stringify(bad)).toThrow(SigningError);
    }
  });
});

describe("splitAmounts mirrors the router", () => {
  it("matches the worked example from the brief", () => {
    expect(splitAmounts(100_000_000n, 1000n, 50n)).toEqual({ commission: 10_000_000n, fee: 500_000n, merchantNet: 89_500_000n });
  });
  it("always rounds down and never loses or invents a unit (fuzz)", () => {
    let seed = 12345;
    const rnd = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    for (let i = 0; i < 500; i++) {
      const gross = BigInt(1 + rnd(1_000_000_000));
      const c = BigInt(rnd(5001));
      const f = BigInt(rnd(101));
      const s = splitAmounts(gross, c, f);
      expect(s.commission + s.fee + s.merchantNet).toBe(gross);
      expect(s.commission).toBe((gross * c) / 10_000n);
      expect(s.merchantNet >= 0n).toBe(true);
    }
  });
});

describe("verifyOrderPayload: the order service is not trusted", () => {
  it("accepts an honest order and returns bigints plus the split", async () => {
    const v = await verify(await honestPayload());
    expect(v.order.gross).toBe(25_000_000n);
    expect(v.order.campaignId).toBe(7n);
    expect(v.split).toEqual({ commission: 4_500_000n, fee: 250_000n, merchantNet: 20_250_000n });
  });

  it("matches addresses case-insensitively", async () => {
    const p = await honestPayload();
    p.order.buyer = p.order.buyer.toLowerCase();
    await expect(verify(p, { expected: { buyer: buyer.address.toUpperCase().replace("0X", "0x") as Address } })).resolves.toBeTruthy();
  });

  it("refuses an order for a different buyer, creator, campaign or amount", async () => {
    await rejects(verify(await honestPayload({ buyer: stranger.address })), "ORDER_MISMATCH");
    await rejects(verify(await honestPayload({ creator: stranger.address })), "ORDER_MISMATCH");
    await rejects(verify(await honestPayload({ campaignId: 8n })), "ORDER_MISMATCH");
    // a server that quietly charges more than the buyer was shown
    await rejects(verify(await honestPayload({ gross: 250_000_000n })), "ORDER_MISMATCH");
    await rejects(verify(await honestPayload({ gross: 24_999_999n })), "ORDER_MISMATCH");
  });

  it("refuses expired orders and orders about to expire", async () => {
    await rejects(verify(await honestPayload({ deadline: BigInt(NOW - 1) })), "ORDER_EXPIRED");
    await rejects(verify(await honestPayload({ deadline: BigInt(NOW + 10) })), "ORDER_EXPIRED");
    await expect(verify(await honestPayload({ deadline: BigInt(NOW + 60) }))).resolves.toBeTruthy();
  });

  it("refuses when the campaign cannot settle or the creator is not approved", async () => {
    await rejects(verify(await honestPayload(), { terms: { settleable: false } }), "CAMPAIGN_NOT_SETTLEABLE");
    await rejects(verify(await honestPayload(), { terms: { creatorApproved: false } }), "CREATOR_NOT_APPROVED");
  });

  it("refuses a merchant that is not the campaign's on-chain merchant", async () => {
    await rejects(verify(await honestPayload({ merchant: stranger.address })), "MERCHANT_MISMATCH");
  });

  it("refuses an order not signed by the campaign's payout signer", async () => {
    await rejects(verify(await honestPayload({}, stranger)), "SIGNER_MISMATCH");
  });

  it("refuses an authorization nonce that does not commit to the on-chain split", async () => {
    const p = await honestPayload();
    // server prepared the nonce for a different (cheaper for it) split than the chain enforces
    const forged = computeOrderCommitment(
      orderCommitmentFromOrder(
        { campaignId: 7n, merchant: merchant.address, creator: creator.address, buyer: buyer.address, gross: 25_000_000n, orderId: p.order.orderId as Hex, deadline: BigInt(NOW + 900) },
        5000n,
        FEE_BPS,
      ),
      CHAIN_ID,
      ROUTER,
    );
    await rejects(verify({ ...p, authNonce: forged }), "NONCE_MISMATCH");
    // and the same honest nonce is refused if the chain's terms differ from what the server assumed
    await rejects(verify(p, { terms: { commissionBps: 2500n } }), "NONCE_MISMATCH");
    await rejects(verify(p, { terms: { feeBps: 50n } }), "NONCE_MISMATCH");
  });

  it("refuses malformed payloads without throwing a raw error", async () => {
    const good = await honestPayload();
    const bad: OrderPayload[] = [
      { ...good, authNonce: "0x1234" },
      { ...good, merchantSig: "0x12" },
      { ...good, order: { ...good.order, orderId: "nope" } },
      { ...good, order: { ...good.order, gross: "-5" } },
      { ...good, order: { ...good.order, buyer: "0xnotanaddress" } },
      { ...good, order: { ...good.order, deadline: "1e9" } },
      {} as OrderPayload,
    ];
    for (const b of bad) await rejects(verify(b), "BAD_PAYLOAD");
  });
});

describe("authorization and relay request", () => {
  it("lives exactly as long as the order", async () => {
    const v = await verify(await honestPayload());
    expect(authorizationWindow(v.order)).toEqual({ validAfter: 0n, validBefore: v.order.deadline });
  });

  it("produces a signature the relayer will accept, in a body the real API schema accepts", async () => {
    const v = await verify(await honestPayload());
    const typed = buildAuthTypedData(v, ROUTER, CHAIN_ID, TOKEN);
    const signature = await buyer.signTypedData(typed);
    const body = toRelayBody(v, signature);

    // The API's own zod schema (what POST /relay validates with).
    const parsed = relayRequest.parse(body);
    expect(parsed.order.gross).toBe(25_000_000n);
    expect([27, 28]).toContain(parsed.auth.v);

    // Re-run the relayer's buyer-auth check: rebuild typed data from the relay request, recover the signer.
    const { auth, order } = parsed;
    const relayerTyped = receiveAuthTypedData(
      { from: order.buyer, router: ROUTER, value: order.gross, validAfter: auth.validAfter, validBefore: auth.validBefore, nonce: v.authNonce },
      CHAIN_ID,
      TOKEN,
    );
    const recovered = await recoverTypedDataAddress({
      ...relayerTyped,
      signature: (`0x${auth.r.slice(2)}${auth.s.slice(2)}${auth.v.toString(16)}`) as Hex,
    });
    expect(recovered).toBe(buyer.address);
  });

  it("signs the exact amount, router and nonce (the wallet shows these to the buyer)", async () => {
    const v = await verify(await honestPayload());
    const t = buildAuthTypedData(v, ROUTER, CHAIN_ID, TOKEN);
    expect(t.message.from).toBe(buyer.address);
    expect(t.message.to).toBe(ROUTER);
    expect(t.message.value).toBe(25_000_000n);
    expect(t.message.nonce).toBe(v.authNonce);
    expect(t.domain).toMatchObject({ name: "Tether USD", version: "1", chainId: CHAIN_ID, verifyingContract: TOKEN });
  });

  it("the create-order request body satisfies the API's schema", () => {
    expect(() =>
      createOrderRequest.parse({ campaignId: "7", creator: creator.address, buyer: buyer.address, amount: "25.00" }),
    ).not.toThrow();
  });
});

describe("splitSignature", () => {
  const r = "11".repeat(32);
  const s = "22".repeat(32);
  it("normalises v = 0/1 (yParity) and 27/28", () => {
    expect(splitSignature(`0x${r}${s}1b` as Hex).v).toBe(27);
    expect(splitSignature(`0x${r}${s}1c` as Hex).v).toBe(28);
    expect(splitSignature(`0x${r}${s}00` as Hex).v).toBe(27);
    expect(splitSignature(`0x${r}${s}01` as Hex).v).toBe(28);
  });
  it("returns r and s untouched", () => {
    const out = splitSignature(`0x${r}${s}1b` as Hex);
    expect(out.r).toBe(`0x${r}`);
    expect(out.s).toBe(`0x${s}`);
  });
  it("rejects malformed signatures", () => {
    expect(() => splitSignature("0x1234" as Hex)).toThrow(SigningError);
    expect(() => splitSignature(`0x${r}${s}` as Hex)).toThrow(SigningError);
  });
});

describe("readChainTerms", () => {
  const baseArgs = { registry: "0x00000000000000000000000000000000000b0b0b" as Address, router: ROUTER, campaignId: 7n, creator: creator.address };

  it("maps the contract reads into ChainTerms", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "getCampaign")
          return { merchant: merchant.address, payoutSigner: payoutSigner.address, commissionBps: 1800n, endsAt: 99n, paused: false, exists: true };
        if (functionName === "isSettleable") return true;
        if (functionName === "isCreatorApproved") return false;
        if (functionName === "feeBps") return 100n;
        throw new Error("unexpected " + functionName);
      }),
    };
    const t = await readChainTerms({ client: client as never, ...baseArgs });
    expect(t).toEqual({ ...terms, creatorApproved: false });
  });

  it("turns any RPC failure into CONTRACTS_UNAVAILABLE", async () => {
    const client = { readContract: vi.fn().mockRejectedValue(new Error("execution reverted")) };
    await rejects(readChainTerms({ client: client as never, ...baseArgs }), "CONTRACTS_UNAVAILABLE");
  });
});

describe("checkout API client", () => {
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  it("POSTs JSON and returns the parsed body", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => ok({ settled: 1 }));
    const out = await relayOrder("/api/relay", { a: 1 }, { fetchImpl: f as never });
    expect(out).toEqual({ settled: 1 });
    expect(f.mock.calls[0]?.[0]).toBe("/api/relay");
    expect(f.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ a: 1 });
  });

  it("carries the relayer's own error code", async () => {
    const f = vi.fn(async () => ok({ error: "DUPLICATE", message: "already used" }, 409));
    const e = await relayOrder("/api/relay", {}, { fetchImpl: f as never }).catch((x) => x);
    expect(e).toBeInstanceOf(CheckoutApiError);
    expect(e).toMatchObject({ code: "DUPLICATE", status: 409, message: "already used" });
  });

  it("classifies non-JSON errors, network failures and timeouts", async () => {
    const html = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await createOrder("/api/orders", { campaignId: "1", creator: "0x", buyer: "0x", amount: "1" }, { fetchImpl: html as never }).catch((x) => x)).toMatchObject({ code: "HTTP_502" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await relayOrder("/api/relay", {}, { fetchImpl: down as never }).catch((x) => x)).toMatchObject({ code: "NETWORK" });
  });

  it("times out a hung relay as NETWORK (outcome unknown), not as a clean failure", async () => {
    vi.useFakeTimers();
    const hung = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    );
    const p = relayOrder("/api/relay", {}, { fetchImpl: hung as never, timeoutMs: 50 });
    const assertion = expect(p).rejects.toMatchObject({ code: "NETWORK" });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });
});

describe("failure messages", () => {
  it("covers every error code the relayer can return (drift guard against apps/api)", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../apps/api/src/services/relayer.ts", import.meta.url)), "utf8");
    const union = src.match(/export type RelayErrorCode =([^;]+);/)?.[1] ?? "";
    const codes = [...union.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(13);
    for (const c of codes) expect(RELAYER_ERROR_CODES, `missing message for ${c}`).toContain(c);
  });

  it("never tells a buyer to blindly retry when the outcome is unknown", () => {
    for (const code of ["DUPLICATE", "TX_TIMEOUT", "INTERNAL", "NETWORK"]) {
      const f = describeRelayFailure(code);
      expect(f.moneyMoved).toBe("unknown");
      expect(f.retry).toBe(false);
    }
  });

  it("gives every code a title and a message, and unknown codes a cautious fallback", () => {
    for (const c of RELAYER_ERROR_CODES) {
      const f = describeRelayFailure(c);
      expect(f.title.length).toBeGreaterThan(5);
      expect(f.message.length).toBeGreaterThan(20);
    }
    expect(describeRelayFailure("SOMETHING_NEW")).toMatchObject({ moneyMoved: "unknown", retry: false });
    expect(describeSigningFailure("NONCE_MISMATCH").moneyMoved).toBe("no");
  });
});

describe("parseCheckoutParams", () => {
  const good = `?campaign=7&creator=${creator.address}&amount=25.00`;
  it("accepts a complete, valid link", () => {
    expect(parseCheckoutParams(good)).toEqual({ ok: true, params: { campaignId: "7", creator: creator.address, amount: "25.00" } });
  });
  it("rejects every missing or malformed field instead of guessing", () => {
    expect(parseCheckoutParams("").ok).toBe(false);
    expect(parseCheckoutParams(`?creator=${creator.address}&amount=1`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=7&amount=1`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=7&creator=${creator.address}`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=x&creator=${creator.address}&amount=1`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=7&creator=0x123&amount=1`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=7&creator=${creator.address}&amount=0`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=7&creator=${creator.address}&amount=1.1234567`).ok).toBe(false);
    expect(parseCheckoutParams(`?campaign=7&creator=${creator.address}&amount=-3`).ok).toBe(false);
  });
});

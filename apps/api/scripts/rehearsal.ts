/**
 * Local end-to-end rehearsal of the real flow against a FORK of Whitechain Sepolia (real USDT proxy, real EIP-3009),
 * before any real deployment. Nothing here touches the real chain or Arkiv.
 *
 *   pnpm --filter @numa/api rehearsal
 *
 * Needs `forge build` output (packages/contracts/out) and anvil on PATH. It spawns the fork, deploys CampaignRegistry and
 * NumaRouter, mints test USDT by impersonating the token owner (fork only), starts the REAL API (relayer, indexer, keeper),
 * runs the REAL checkout code (@numa/sdk-react) with a local wallet that holds zero WBT, and asserts balances on-chain.
 * What it does NOT prove: the real chain's behaviour under load, real wallets, Arkiv mirroring (noop sink), the real faucet.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createTestClient, createWalletClient, getAddress, http, parseAbi, parseEventLogs, type Address, type EIP1193Provider, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, whitechainSepolia } from "@numa/shared";
import { CampaignRegistryAbi, NumaRouterAbi } from "@numa/shared";
import { runCheckout } from "@numa/sdk-react/core";
import { buildServer } from "../src/server.js";
import { loadEnv } from "../src/config/env.js";
import { runPreflight, summarize } from "../src/preflight.js";

const FORK_URL = process.env.REHEARSAL_FORK_URL ?? "https://rpc.testnet.whitechain.io";
const ANVIL_PORT = 8547, API_PORT = 8788;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const out = (n: string) => JSON.parse(readFileSync(join(here, `../../../packages/contracts/out/${n}.sol/${n}.json`), "utf8")) as { abi: never; bytecode: { object: Hex } };
const REFUND_WINDOW = 20, FEE_BPS = 50n, COMMISSION_BPS = 1000n;
const usdtAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function owner() view returns (address)", "function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);

const results: [string, boolean, string][] = [];
const step = async (name: string, fn: () => Promise<string | void>) => {
  try { const d = (await fn()) ?? ""; results.push([name, true, d]); console.log(`PASS  ${name}${d ? "  " + d : ""}`); }
  catch (e) { results.push([name, false, String(e)]); console.log(`FAIL  ${name}  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let anvil: ChildProcess | undefined;
async function main() {
  anvil = spawn("anvil", ["--fork-url", FORK_URL, "--chain-id", "1874", "--port", String(ANVIL_PORT), "--silent"], { stdio: "ignore" });
  const chain = { ...whitechainSepolia, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
  for (let i = 0; i < 40; i++) { try { await pub.getChainId(); break; } catch { await sleep(500); } }
  assert((await pub.getChainId()) === 1874, "fork not running");

  const keys = { deployer: generatePrivateKey(), merchant: generatePrivateKey(), payout: generatePrivateKey(), creator: generatePrivateKey(), buyer: generatePrivateKey(), relayer: generatePrivateKey(), fee: generatePrivateKey() };
  const acct = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<keyof typeof keys, ReturnType<typeof privateKeyToAccount>>;
  const wallet = (a: ReturnType<typeof privateKeyToAccount>) => createWalletClient({ account: a, chain, transport: http(RPC) });
  const wei = (n: number) => `0x${(BigInt(n) * 10n ** 18n).toString(16)}` as Hex;
  for (const k of ["deployer", "merchant", "relayer"] as const) await test.setBalance({ address: acct[k].address, value: BigInt(wei(5)) });
  const bal = (a: Address) => pub.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [a] });

  let registry!: Address, router!: Address, deployBlock = 0n, campaignId = 0n;
  await step("deploy CampaignRegistry + NumaRouter on the fork", async () => {
    const reg = out("CampaignRegistry"), rt = out("NumaRouter");
    const w = wallet(acct.deployer);
    const h1 = await w.deployContract({ abi: reg.abi, bytecode: reg.bytecode.object, args: [] });
    registry = (await pub.waitForTransactionReceipt({ hash: h1 })).contractAddress!;
    const h2 = await w.deployContract({ abi: rt.abi, bytecode: rt.bytecode.object, args: [USDT_ADDRESS, registry, acct.fee.address, FEE_BPS, BigInt(REFUND_WINDOW)] });
    const r2 = await pub.waitForTransactionReceipt({ hash: h2 });
    router = r2.contractAddress!; deployBlock = r2.blockNumber;
    return `registry ${registry.slice(0, 8)}… router ${router.slice(0, 8)}…`;
  });

  await step("merchant creates a campaign, approves the creator; buyer is funded with real-token USDT and zero WBT", async () => {
    const wm = wallet(acct.merchant);
    const endsAt = BigInt(Math.floor(Date.now() / 1000) + 86_400);
    const h = await wm.writeContract({ address: registry, abi: CampaignRegistryAbi, functionName: "createCampaign", args: [acct.payout.address, COMMISSION_BPS, endsAt] });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    const ev = parseEventLogs({ abi: CampaignRegistryAbi, logs: rc.logs, eventName: "CampaignCreated" })[0] as unknown as { args: { campaignId: bigint } };
    campaignId = ev.args.campaignId;
    await pub.waitForTransactionReceipt({ hash: await wm.writeContract({ address: registry, abi: CampaignRegistryAbi, functionName: "approveCreator", args: [campaignId, acct.creator.address] }) });
    // The token owner can mint on the real contract; on a fork we impersonate them. This is the ONLY way USDT is created here.
    const owner = await pub.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "owner" });
    await test.impersonateAccount({ address: owner }); await test.setBalance({ address: owner, value: BigInt(wei(1)) });
    const asOwner = createWalletClient({ account: owner, chain, transport: http(RPC) });
    await pub.waitForTransactionReceipt({ hash: await asOwner.writeContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "mint", args: [acct.buyer.address, 500_000_000n] }) });
    // The merchant must pre-approve the router so refunds can be pulled (ADR 0001).
    await pub.waitForTransactionReceipt({ hash: await wm.writeContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "approve", args: [router, 10n ** 12n] }) });
    assert((await pub.getBalance({ address: acct.buyer.address })) === 0n, "buyer must hold zero WBT");
    assert((await bal(acct.buyer.address)) === 500_000_000n, "buyer USDT not minted");
    return `campaign ${campaignId}`;
  });

  // ---- the real API: relayer + indexer + keeper ----
  const env = loadEnv({
    PORT: String(API_PORT), WHITECHAIN_RPC_URL: RPC, WHITECHAIN_CHAIN_ID: "1874", NUMA_ROUTER_ADDRESS: router, CAMPAIGN_REGISTRY_ADDRESS: registry,
    RELAYER_PRIVATE_KEY: keys.relayer, MERCHANT_SIGNER_KEY: keys.payout, RELAYER_MAX_GAS_PRICE_GWEI: "1000", RELAYER_DAILY_CAP_WBT: "4", RELAYER_PER_ADDRESS_DAILY_LIMIT: "10",
    RATE_LIMIT_PER_MINUTE: "1000", INDEXER_START_BLOCK: deployBlock.toString(), INDEXER_POLL_MS: "1000", KEEPER_POLL_MS: "1000",
  });
  const app = buildServer(env, { logLevel: process.env.REHEARSAL_VERBOSE ? "info" : "warn" });
  await app.listen({ port: API_PORT, host: "127.0.0.1" });
  const API = `http://127.0.0.1:${API_PORT}`;

  // A wallet that behaves like an injected one: signs EIP-712 locally, reads from the fork, never sends a transaction.
  const calls: string[] = [];
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push(method);
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [acct.buyer.address];
        case "eth_chainId": return "0x752";
        case "eth_signTypedData_v4": {
          const t = JSON.parse(params![1] as string) as { domain: never; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
          const { EIP712Domain: _d, ...types } = t.types;
          const message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, types[t.primaryType]!.find((f) => f.name === k)!.type.startsWith("uint") ? BigInt(v as string) : v]));
          return acct.buyer.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message });
        }
        default: return pub.request({ method: method as never, params: params as never });
      }
    },
  } as unknown as EIP1193Provider;
  let lastRelayBody = "";
  const recordingFetch = ((url: string, init?: RequestInit) => { if (String(url).endsWith("/relay") && init?.method === "POST") lastRelayBody = String(init.body); return fetch(url, init); }) as typeof fetch;
  const checkout = (amount: string) => runCheckout({ orderUrl: `${API}/orders`, relayUrl: API, params: { campaignId: campaignId.toString(), creator: acct.creator.address, amount }, provider, pollMs: 500, fetch: recordingFetch });

  const settlement = (id: Hex) => pub.readContract({ address: router, abi: NumaRouterAbi, functionName: "getSettlement", args: [id] }) as Promise<{ gross: bigint; commission: bigint; fee: bigint; heldCommission: bigint; refundedGross: bigint; released: boolean; exists: boolean }>;
  let order1: Hex = "0x";
  await step("gasless checkout settles a $100 order: split is exact, buyer pays no gas", async () => {
    const m0 = await bal(acct.merchant.address), f0 = await bal(acct.fee.address), b0 = await bal(acct.buyer.address);
    const r = await checkout("100.00");
    order1 = r.orderId;
    const gross = 100_000_000n, commission = (gross * COMMISSION_BPS) / 10_000n, fee = (gross * FEE_BPS) / 10_000n;
    assert((await bal(acct.merchant.address)) - m0 === gross - commission - fee, "merchant net wrong");
    assert((await bal(acct.fee.address)) - f0 === fee, "fee wrong");
    assert(b0 - (await bal(acct.buyer.address)) === gross, "buyer should pay exactly gross");
    assert((await bal(router)) === commission, "router should hold exactly the commission");
    assert((await pub.getBalance({ address: acct.buyer.address })) === 0n, "buyer's WBT changed");
    assert(!calls.includes("eth_sendTransaction"), "buyer sent a transaction");
    const s = await settlement(order1);
    assert(s.exists && s.heldCommission === commission && !s.released, "settlement record wrong");
    return `tx ${r.txHash.slice(0, 10)}…`;
  });

  await step("relayer status endpoint reports settled", async () => {
    const j = (await (await fetch(`${API}/relay/${order1}`)).json()) as { status: string };
    assert(j.status === "settled", `status ${j.status}`);
  });

  await step("re-sending the exact relay body of a settled order is rejected as a duplicate (no second charge)", async () => {
    await checkout("5.00"); // settles, and records the real relay body the checkout produced
    const b0 = await bal(acct.buyer.address), router0 = await bal(router);
    const res = await fetch(`${API}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: lastRelayBody });
    const j = (await res.json()) as { error?: string };
    assert(res.status === 409 && j.error === "DUPLICATE", `expected 409 DUPLICATE, got ${res.status} ${JSON.stringify(j)}`);
    assert((await bal(acct.buyer.address)) === b0 && (await bal(router)) === router0, "balances moved on a duplicate");
  });

  await step("a forged request (creator swapped after the buyer signed) is refused before any gas is spent", async () => {
    const order = (await (await fetch(`${API}/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaignId.toString(), creator: acct.creator.address, buyer: acct.buyer.address, amount: "10.00" }) })).json()) as { order: Record<string, string>; merchantSig: Hex; authNonce: Hex };
    const { signTypedData } = acct.buyer;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
    const sig = await signTypedData({
      domain: { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: USDT_ADDRESS },
      types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "ReceiveWithAuthorization",
      message: { from: acct.buyer.address, to: router, value: BigInt(order.order.gross!), validAfter: 0n, validBefore, nonce: order.authNonce },
    });
    const r = `0x${sig.slice(2, 66)}` as Hex, s = `0x${sig.slice(66, 130)}` as Hex, v = Number.parseInt(sig.slice(130, 132), 16);
    const attacker = getAddress(`0x${"dead".repeat(10)}`);
    const relayerBefore = await pub.getBalance({ address: acct.relayer.address });
    const res = await fetch(`${API}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: { ...order.order, creator: attacker }, merchantSig: order.merchantSig, auth: { validAfter: "0", validBefore: validBefore.toString(), v, r, s } }) });
    const j = (await res.json()) as { error?: string };
    assert(res.status === 422 && !!j.error, `expected rejection, got ${res.status} ${JSON.stringify(j)}`);
    assert((await pub.getBalance({ address: acct.relayer.address })) === relayerBefore, "relayer spent gas on a forged request");
    return `rejected: ${j.error}`;
  });

  await step("keeper releases the creator's commission automatically once the refund window passes", async () => {
    const commission = 10_000_000n;
    const c0 = await bal(acct.creator.address), router0 = await bal(router);
    await test.increaseTime({ seconds: REFUND_WINDOW + 5 });
    await test.mine({ blocks: 1 });
    for (let i = 0; i < 40; i++) { if ((await settlement(order1)).released) break; await sleep(500); }
    const s = await settlement(order1);
    assert(s.released, "keeper never released the commission");
    assert((await bal(acct.creator.address)) - c0 === commission, "creator did not receive the commission");
    assert(router0 - (await bal(router)) >= commission, "router should have paid out the released commission");
  });

  await step("partial refund: merchant refunds $20 of a $50 order, commission is clawed back proportionally, the rest is pulled from the merchant", async () => {
    const r = await checkout("50.00");
    const gross = 50_000_000n, fee = (gross * FEE_BPS) / 10_000n, commission = (gross * COMMISSION_BPS) / 10_000n;
    const refundable = gross - fee;
    const refund = 20_000_000n;
    const clawback = (commission * refund) / refundable, pull = refund - clawback;
    const b0 = await bal(acct.buyer.address), m0 = await bal(acct.merchant.address);
    await pub.waitForTransactionReceipt({ hash: await wallet(acct.merchant).writeContract({ address: router, abi: NumaRouterAbi, functionName: "refund", args: [r.orderId, refund] }) });
    assert((await bal(acct.buyer.address)) - b0 === refund, "buyer should receive exactly the refund");
    assert(m0 - (await bal(acct.merchant.address)) === pull, "merchant should fund exactly the non-clawed part");
    const s = await settlement(r.orderId);
    assert(s.heldCommission === commission - clawback && s.refundedGross === refund, "settlement accounting wrong");
    await test.increaseTime({ seconds: REFUND_WINDOW + 5 }); await test.mine({ blocks: 1 });
    const c0 = await bal(acct.creator.address);
    for (let i = 0; i < 40; i++) { if ((await settlement(r.orderId)).released) break; await sleep(500); }
    assert((await bal(acct.creator.address)) - c0 === commission - clawback, "creator should receive only the unclawed commission");
    return `clawback ${clawback}, merchant pull ${pull}`;
  });

  await step("buyer without enough USDT is stopped before signing", async () => {
    const broke = privateKeyToAccount(generatePrivateKey());
    const p2 = { request: ({ method, params }: { method: string; params?: unknown[] }) => (method === "eth_requestAccounts" || method === "eth_accounts" ? [broke.address] : method === "eth_chainId" ? "0x752" : pub.request({ method: method as never, params: params as never })) } as unknown as EIP1193Provider;
    try { await runCheckout({ orderUrl: `${API}/orders`, relayUrl: API, params: { campaignId: campaignId.toString(), creator: acct.creator.address, amount: "5.00" }, provider: p2 }); throw new Error("should have failed"); }
    catch (e) { assert((e as { code?: string }).code === "INSUFFICIENT_USDT", `got ${(e as Error).message}`); }
  });

  await step("preflight finds no failures on this deployment", async () => {
    const checks = await runPreflight(env, pub, { campaignId });
    const bad = checks.filter((c) => c.level === "fail");
    assert(bad.length === 0, bad.map((c) => `${c.name}: ${c.detail}`).join("; "));
    const s = summarize(checks);
    return `${checks.length - s.warned} ok, ${s.warned} expected warnings (no Postgres/CORS/Arkiv in this rehearsal)`;
  });

  await step("customer receipt and accountant CSV match the on-chain balances", async () => {
    const rc = (await (await fetch(`${API}/receipts/${order1}`)).json()) as { status: string; grossUsdt: string; commissionReleased: boolean; explorerUrl: string };
    assert(rc.status === "released" && rc.grossUsdt === "100.000000" && rc.commissionReleased, `receipt wrong: ${JSON.stringify(rc)}`);
    assert(rc.explorerUrl.includes("/tx/0x"), "receipt has no explorer link");
    const csv = await fetch(`${API}/merchants/${acct.merchant.address}/orders?format=csv`);
    assert((csv.headers.get("content-type") ?? "").includes("text/csv"), "not a CSV");
    const [head, ...lines] = (await csv.text()).trim().split("\n");
    const cols = head!.split(",");
    const rows = lines.map((l) => l.split(","));
    assert(rows.length === 3, `expected 3 settled orders, got ${rows.length}`); // $100, $50 (partly refunded) and the $5 duplicate-test order
    const col = (r: string[], n: string) => r[cols.indexOf(n)]!;
    const sum = (n: string) => rows.reduce((a, r) => a + Number(col(r, n)), 0);
    // merchant's own on-chain USDT movement must equal CSV net-after-refunds
    const received = Number(await bal(acct.merchant.address)) / 1e6;
    assert(Math.abs(sum("merchant_net_after_refunds_usdt") - received) < 0.000001, `CSV net ${sum("merchant_net_after_refunds_usdt")} != on-chain ${received}`);
    assert(rows.filter((r) => col(r, "status") === "partially_refunded").length === 1, "expected one partially refunded order");
    return `3 orders, merchant net after refunds ${received} USDT = on-chain balance`;
  });

  await app.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  return failed;
}

main().then((f) => { if (!process.env.REHEARSAL_KEEP) anvil?.kill(); process.exit(f ? 1 : 0); }).catch((e) => { console.error(e); anvil?.kill(); process.exit(1); });

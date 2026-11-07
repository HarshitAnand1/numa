import { hashDomain, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NumaRouterAbi, USDT_ADDRESS, USDT_DOMAIN_NAME, USDT_DOMAIN_VERSION, campaignRegistryAbi, numaRouterAbi } from "@numa/shared";
import { parseAbi } from "viem";
import type { Env } from "./config/env.js";

export type Level = "ok" | "warn" | "fail";
export interface Check { name: string; level: Level; detail: string }

const tokenAbi = parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)", "function decimals() view returns (uint8)"]);

/**
 * Deploy-day sanity checks. Read-only: it never sends a transaction. Run it after filling `.env` with real addresses.
 * `campaignId` is optional: when given, it also checks that this API's merchant signer is that campaign's payout signer.
 */
export async function runPreflight(env: Env, pub: Pick<PublicClient, "getChainId" | "getCode" | "readContract" | "getBalance" | "getGasPrice">, opts: { campaignId?: bigint } = {}): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, level: Level, detail: string) => out.push({ name, level, detail });
  const safe = async (name: string, fn: () => Promise<[Level, string]>) => { try { const [l, d] = await fn(); add(name, l, d); } catch (e) { add(name, "fail", e instanceof Error ? e.message.split("\n")[0]! : String(e)); } };

  await safe("RPC reachable and on the expected chain", async () => {
    const id = await pub.getChainId();
    return id === env.WHITECHAIN_CHAIN_ID ? ["ok", `chain ${id}`] : ["fail", `RPC is chain ${id}, config expects ${env.WHITECHAIN_CHAIN_ID}`];
  });
  for (const [label, address] of [["NumaRouter", env.NUMA_ROUTER_ADDRESS], ["CampaignRegistry", env.CAMPAIGN_REGISTRY_ADDRESS]] as const) {
    await safe(`${label} has contract code`, async () => { const c = await pub.getCode({ address }); return c && c !== "0x" ? ["ok", address] : ["fail", `no code at ${address}`]; });
  }
  await safe("router is wired to this registry and the real USDT", async () => {
    const [reg, usdt] = await Promise.all([
      pub.readContract({ address: env.NUMA_ROUTER_ADDRESS, abi: NumaRouterAbi, functionName: "registry" }) as Promise<string>,
      pub.readContract({ address: env.NUMA_ROUTER_ADDRESS, abi: NumaRouterAbi, functionName: "usdt" }) as Promise<string>,
    ]);
    if (reg.toLowerCase() !== env.CAMPAIGN_REGISTRY_ADDRESS.toLowerCase()) return ["fail", `router.registry() is ${reg}, not ${env.CAMPAIGN_REGISTRY_ADDRESS}`];
    if (usdt.toLowerCase() !== USDT_ADDRESS.toLowerCase()) return ["fail", `router.usdt() is ${usdt}, not the Whitechain test USDT ${USDT_ADDRESS}`];
    return ["ok", "registry and USDT match"];
  });
  await safe("router fee and refund window", async () => {
    const [fee, win] = await Promise.all([
      pub.readContract({ address: env.NUMA_ROUTER_ADDRESS, abi: numaRouterAbi, functionName: "feeBps" }),
      pub.readContract({ address: env.NUMA_ROUTER_ADDRESS, abi: numaRouterAbi, functionName: "refundWindow" }),
    ]);
    const d = `feeBps ${fee}, refundWindow ${win}s`;
    return Number(win) > 3600 ? ["warn", `${d}: a demo needs a short window (e.g. 60s) so release can be shown live`] : ["ok", d];
  });
  await safe("USDT EIP-712 domain on chain matches the one the checkout signs", async () => {
    const onChain = await pub.readContract({ address: USDT_ADDRESS, abi: tokenAbi, functionName: "DOMAIN_SEPARATOR" });
    const ours = hashDomain({ domain: { name: USDT_DOMAIN_NAME, version: USDT_DOMAIN_VERSION, chainId: BigInt(env.WHITECHAIN_CHAIN_ID), verifyingContract: USDT_ADDRESS }, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } });
    return onChain === ours ? ["ok", "DOMAIN_SEPARATOR matches"] : ["fail", "DOMAIN_SEPARATOR differs: every buyer signature would be rejected"];
  });
  await safe("relayer wallet can pay for gas", async () => {
    const addr = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`).address;
    const [bal, price] = await Promise.all([pub.getBalance({ address: addr }), pub.getGasPrice()]);
    const wbt = Number(bal) / 1e18;
    if (bal === 0n) return ["fail", `${addr} holds 0 WBT: claim some from https://faucet.testnet.whitechain.io`];
    const ceiling = BigInt(Math.round(env.RELAYER_MAX_GAS_PRICE_GWEI * 1e9));
    if (price > ceiling) return ["fail", `network gas price ${Number(price) / 1e9} gwei is above RELAYER_MAX_GAS_PRICE_GWEI (${env.RELAYER_MAX_GAS_PRICE_GWEI}): every relay would be refused`];
    const capWbt = env.RELAYER_DAILY_CAP_WBT;
    return wbt < capWbt ? ["warn", `${addr} holds ${wbt.toFixed(4)} WBT, below the daily cap of ${capWbt}`] : ["ok", `${addr} holds ${wbt.toFixed(4)} WBT`];
  });
  if (env.MERCHANT_SIGNER_KEY && opts.campaignId !== undefined) {
    const id = opts.campaignId;
    await safe(`demo merchant signer is campaign ${id}'s payout signer`, async () => {
      const c = await pub.readContract({ address: env.CAMPAIGN_REGISTRY_ADDRESS, abi: campaignRegistryAbi, functionName: "getCampaign", args: [id] });
      if (!c.exists) return ["fail", `campaign ${id} does not exist`];
      const signer = privateKeyToAccount(env.MERCHANT_SIGNER_KEY as `0x${string}`).address;
      return c.payoutSigner.toLowerCase() === signer.toLowerCase() ? ["ok", `signer ${signer}`] : ["fail", `campaign payoutSigner is ${c.payoutSigner} but MERCHANT_SIGNER_KEY is ${signer}: POST /orders would produce orders the router rejects`];
    });
  } else if (!env.MERCHANT_SIGNER_KEY) add("demo merchant signer", "warn", "MERCHANT_SIGNER_KEY unset: POST /orders returns 501 (fine if merchants sign in their own backend)");
  if (!env.DATABASE_URL) add("Postgres", "warn", "DATABASE_URL unset: relayer limits, claims and the indexer cursor are in memory and lost on restart");
  if (!env.CORS_ORIGINS) add("CORS", "warn", "CORS_ORIGINS unset: a web app on another origin cannot call this API");
  if (!env.ARKIV_WRITER_PRIVATE_KEY) add("Arkiv writer", "warn", "ARKIV_WRITER_PRIVATE_KEY unset: conversions are not mirrored to Arkiv and discovery routes are off");
  return out;
}

export const summarize = (checks: Check[]) => ({ failed: checks.filter((c) => c.level === "fail").length, warned: checks.filter((c) => c.level === "warn").length });
export type { Address };

/**
 * ONE REAL payment on the DEPLOYED contracts, to produce the settled-USDT explorer link the Whitechain track asks for.
 *
 *   LIVE_MERCHANT_KEY=0x… LIVE_BUYER_KEY=0x… pnpm --filter @numa/api live:payment
 *
 * This script SENDS real transactions and spends real testnet WBT, so it only runs when you start it yourself.
 * It never prints a key. What it does, in order:
 *   1. checks the hosted API (or API_URL) is reachable and its signer address matches MERCHANT_SIGNER_ADDRESS;
 *   2. merchant wallet: createCampaign (payoutSigner = the API's order signer), approveCreator, USDT.approve(router) for refunds;
 *   3. buyer wallet: runs the REAL checkout (@numa/sdk-react core) with a local wallet that signs but never sends a transaction,
 *      so the buyer needs USDT and ZERO WBT; the relayer submits `payOrder`;
 *   4. prints the explorer links, the on-chain split and the settlement record.
 *
 * Needs, in the environment (never in the repo):
 *   LIVE_MERCHANT_KEY      a wallet holding a little WBT (pays for steps 2)
 *   LIVE_BUYER_KEY         a wallet holding >= PRICE test USDT (default 10) and no WBT is fine
 *   MERCHANT_SIGNER_ADDRESS the address of the key the API signs orders with (the API's MERCHANT_SIGNER_KEY)
 *   LIVE_CREATOR_ADDRESS   optional; a fresh random creator address is used (and printed) when unset
 *   API_URL                optional; defaults to the hosted API
 *   LIVE_PRICE             optional USDT amount, default 10.00 (the refund window on the deployed router is 60 s)
 */
import {
  createPublicClient, createWalletClient, getAddress, http, isAddress, parseAbi, parseEventLogs, type Address, type EIP1193Provider, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CampaignRegistryAbi, DEPLOYED_ADDRESSES, NumaRouterAbi, whitechainSepolia } from "@numa/shared";
// Imported by path (not as a dependency) so the API image does not pull in the browser SDK's dependencies.
import { runCheckout } from "../../../packages/sdk-react/src/core.js";

const CHAIN_ID = 1874;
const recorded = DEPLOYED_ADDRESSES[CHAIN_ID];
if (!recorded) throw new Error("No deployed addresses recorded for chain 1874.");
const dep = recorded;
const EXPLORER = "https://explorer.testnet.whitechain.io";
const API = (process.env.API_URL ?? "https://numa-api-ivax.onrender.com").replace(/\/+$/, "");
const PRICE = process.env.LIVE_PRICE ?? "10.00";
const RPC = process.env.WHITECHAIN_RPC_URL ?? whitechainSepolia.rpcUrls.default.http[0];

const need = (name: string): Hex => {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be set to a 0x-prefixed 32-byte private key (it is never printed).`);
  return v as Hex;
};
const link = (kind: "tx" | "address", v: string) => `${EXPLORER}/${kind}/${v}`;
const log = (msg: string) => console.log(msg);

const usdtAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

async function main() {
  const merchant = privateKeyToAccount(need("LIVE_MERCHANT_KEY"));
  const buyer = privateKeyToAccount(need("LIVE_BUYER_KEY"));
  const signerEnv = process.env.MERCHANT_SIGNER_ADDRESS;
  if (!signerEnv || !isAddress(signerEnv)) throw new Error("Set MERCHANT_SIGNER_ADDRESS to the address of the API's order-signing key.");
  const payoutSigner = getAddress(signerEnv);
  const creator = process.env.LIVE_CREATOR_ADDRESS ? getAddress(process.env.LIVE_CREATOR_ADDRESS) : privateKeyToAccount(generatePrivateKey()).address;
  if (creator.toLowerCase() === merchant.address.toLowerCase()) throw new Error("The creator must be a different wallet from the merchant.");

  const chain = { ...whitechainSepolia, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  if ((await pub.getChainId()) !== CHAIN_ID) throw new Error(`RPC is not chain ${CHAIN_ID}.`);
  const bal = (a: Address) => pub.readContract({ address: dep.usdt, abi: usdtAbi, functionName: "balanceOf", args: [a] });

  // --- checks before anything is sent ---
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`API ${API} is not answering /health (the free tier sleeps: open it once, wait, retry).`);
  const need6 = BigInt(Math.round(Number(PRICE) * 1_000_000));
  const buyerUsdt = await bal(buyer.address);
  if (buyerUsdt < need6) throw new Error(`Buyer ${buyer.address} holds ${buyerUsdt} base units of USDT; needs at least ${need6}.`);
  if ((await pub.getBalance({ address: merchant.address })) === 0n) throw new Error(`Merchant ${merchant.address} has no WBT for gas.`);
  log(`merchant ${merchant.address}\nbuyer    ${buyer.address} (WBT ${await pub.getBalance({ address: buyer.address })} wei)\ncreator  ${creator}\nsigner   ${payoutSigner}\nAPI      ${API}\n`);

  const wm = createWalletClient({ account: merchant, chain, transport: http(RPC) });

  // --- merchant side: three real transactions ---
  const endsAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
  const h1 = await wm.writeContract({ address: dep.campaignRegistry, abi: CampaignRegistryAbi, functionName: "createCampaign", args: [payoutSigner, 1000n, endsAt] });
  const rc = await pub.waitForTransactionReceipt({ hash: h1 });
  if (rc.status !== "success") throw new Error(`createCampaign reverted: ${link("tx", h1)}`);
  const ev = parseEventLogs({ abi: CampaignRegistryAbi, logs: rc.logs, eventName: "CampaignCreated" })[0] as unknown as { args: { campaignId: bigint } } | undefined;
  if (!ev) throw new Error(`Campaign created but its id was not in the receipt: ${link("tx", h1)}`);
  const campaignId = ev.args.campaignId;
  log(`1. campaign #${campaignId} created (10% commission)   ${link("tx", h1)}`);

  const h2 = await wm.writeContract({ address: dep.campaignRegistry, abi: CampaignRegistryAbi, functionName: "approveCreator", args: [campaignId, creator] });
  if ((await pub.waitForTransactionReceipt({ hash: h2 })).status !== "success") throw new Error(`approveCreator reverted: ${link("tx", h2)}`);
  log(`2. creator approved                                  ${link("tx", h2)}`);

  const h3 = await wm.writeContract({ address: dep.usdt, abi: usdtAbi, functionName: "approve", args: [dep.numaRouter, 10n ** 9n] });
  if ((await pub.waitForTransactionReceipt({ hash: h3 })).status !== "success") throw new Error(`USDT.approve reverted: ${link("tx", h3)}`);
  log(`3. router may pull refunds from the merchant         ${link("tx", h3)}\n`);

  // --- buyer side: the real checkout. The wallet signs EIP-712 and reads the chain; it NEVER sends a transaction. ---
  const sent: string[] = [];
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [buyer.address];
        case "eth_chainId": return `0x${CHAIN_ID.toString(16)}`;
        case "eth_sendTransaction": case "eth_sendRawTransaction": sent.push(method); throw new Error("the buyer must not send transactions");
        case "eth_signTypedData_v4": {
          const t = JSON.parse(params![1] as string) as { domain: never; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
          const { EIP712Domain: _d, ...types } = t.types;
          const message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, types[t.primaryType]!.find((f) => f.name === k)!.type.startsWith("uint") ? BigInt(v as string) : v]));
          return buyer.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message });
        }
        default: return pub.request({ method: method as never, params: params as never });
      }
    },
  } as unknown as EIP1193Provider;

  const b0 = await bal(buyer.address), m0 = await bal(merchant.address);
  log(`4. buyer signs one authorization for ${PRICE} USDT; the relayer submits it…`);
  const paid = await runCheckout({ orderUrl: `${API}/orders`, relayUrl: API, params: { campaignId: campaignId.toString(), creator, amount: PRICE }, provider, pollMs: 2000 });
  if (sent.length) throw new Error("the buyer wallet sent a transaction: that is a bug");

  const s = (await pub.readContract({ address: dep.numaRouter, abi: NumaRouterAbi, functionName: "getSettlement", args: [paid.orderId] })) as { gross: bigint; commission: bigint; fee: bigint; heldCommission: bigint; released: boolean };
  log(`\nSETTLED  ${link("tx", paid.txHash)}`);
  log(`order    ${paid.orderId}`);
  log(`buyer paid      ${b0 - (await bal(buyer.address))} (base units, 6 decimals), WBT spent by buyer: 0`);
  log(`merchant net    +${(await bal(merchant.address)) - m0}`);
  log(`commission held ${s.heldCommission} (released automatically after the 60 s refund window; released=${s.released})`);
  log(`protocol fee    ${s.fee}`);
  log(`\nPut this line in the README:  settled USDT payment: ${link("tx", paid.txHash)}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

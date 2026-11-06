/**
 * Live check of the BROWSER-WALLET write path on Rabdi, without a browser.
 *   pnpm --filter @numa/arkiv live:browser
 *
 * It drives `createArkivBrowserWriter` through a stand-in EIP-1193 provider that behaves like an injected wallet:
 * the SDK sends `eth_sendTransaction` (a JSON-RPC account, no private key in the SDK), and the provider signs and
 * broadcasts it. This proves our code path (custom transport + JSON-RPC account + SafeWriter parameters) works against
 * the real chain. It does NOT prove MetaMask or another extension behaves the same: real wallets can show their own gas
 * UI, re-estimate or override fields. Test that by hand (docs/ARKIV.md -> "Browser wallets").
 */
import { createPublicClient, formatEther, http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getBalance } from "viem/actions";
import { arkivChain, createArkivBrowserWriter, createArkivReader, listAgentBindings, publishAgentBinding, publishProfile, rabdiAddChainParams } from "../src/index.js";

const raw = process.env.ARKIV_TEST_CREATOR_KEY;
if (!raw || !isHex(raw) || raw.length !== 66) throw new Error("ARKIV_TEST_CREATOR_KEY missing in .env");
const account = privateKeyToAccount(raw);
const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";
const chain = arkivChain(accessKey);
const rpc = createPublicClient({ chain, transport: http() });
const reader = createArkivReader(accessKey);
const seen: string[][] = [];

/** Stand-in injected wallet: signs eth_sendTransaction locally and broadcasts; forwards every other call to the node. */
const provider = {
  async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return `0x${chain.id.toString(16)}`;
    if (method === "eth_sendTransaction") {
      const tx = (params as Record<string, string>[])[0]!;
      seen.push(Object.keys(tx).sort());
      const signed = await account.signTransaction({
        chainId: chain.id, to: tx.to as Hex, data: tx.data as Hex, value: tx.value ? BigInt(tx.value) : 0n,
        gas: BigInt(tx.gas!), gasPrice: BigInt(tx.gasPrice!), nonce: Number(BigInt(tx.nonce!)), type: "legacy",
      });
      return rpc.request({ method: "eth_sendRawTransaction", params: [signed] });
    }
    return rpc.request({ method: method as never, params: params as never });
  },
} as never;

const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => Promise<string | void>) {
  try { const d = (await fn()) ?? ""; results.push([name, true, d]); console.log(`PASS  ${name}  ${d}`); } catch (e) { results.push([name, false, String(e)]); console.log(`FAIL  ${name}  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
}

async function main() {
  console.log(`wallet ${account.address} holds ${formatEther(await getBalance(rpc, { address: account.address }))} tGLM`);
  const writer = createArkivBrowserWriter({ provider, address: account.address, accessKey });
  const keys: Hex[] = [];
  await check("wallet_addEthereumChain params describe Rabdi", async () => {
    const p = rabdiAddChainParams();
    if (p.chainId !== "0x76edaf" || p.nativeCurrency.symbol !== "tGLM" || !p.rpcUrls[0]?.startsWith("https://")) throw new Error(JSON.stringify(p));
    if (JSON.stringify(p).includes("accessKey") || p.rpcUrls[0].includes("key")) throw new Error("params leak an access key");
  });
  try {
    await check("browser-style writer publishes an agent binding that reads back under the owner", async () => {
      const r = await publishAgentBinding(writer, { agent: "0x00000000000000000000000000000000000000c3", role: "creator" });
      keys.push(r.entityKey);
      const t0 = Date.now();
      for (;;) {
        const b = await listAgentBindings(reader, account.address, "creator");
        if (b.some((x) => x.entityKey === r.entityKey)) return `visible after ${Date.now() - t0}ms; wallet request fields: ${seen.at(-1)!.join(",")}`;
        if (Date.now() - t0 > 60_000) throw new Error("not visible in 60s");
        await new Promise((res) => setTimeout(res, 1500));
      }
    });
    await check("two sequential writes through the wallet do not collide on nonce", async () => {
      const a = await publishProfile(writer, { displayName: "Browser Check", bio: "live:browser", niche: "browsercheck", channel: "youtube", handle: "https://example.com/b", minAskBps: 500, open: true });
      keys.push(a.entityKey);
      const b = await publishAgentBinding(writer, { agent: "0x00000000000000000000000000000000000000c4", role: "creator" });
      keys.push(b.entityKey);
      return "2 writes accepted";
    });
  } finally {
    for (const k of keys) { try { await writer.deleteEntity({ entityKey: k }); } catch (e) { console.log("cleanup failed", k, e instanceof Error ? e.message.split("\n")[0] : ""); } }
  }
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

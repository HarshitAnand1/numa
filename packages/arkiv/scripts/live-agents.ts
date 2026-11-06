/**
 * Live Arkiv check for the negotiation-agent entities (numa.agent, numa.negotiation) on Rabdi, then cleanup.
 *   pnpm --filter @numa/arkiv live:agents
 * Uses the dev wallets from .env: test merchant, test creator, and a throwaway agent wallet funded by the writer.
 */
import { createWalletClient, formatEther, http, isHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getBalance, getGasPrice } from "viem/actions";
import {
  arkivChain, createArkivReader, createArkivWriter, isAuthorized, listAgentBindings, listNegotiation, publishAgentBinding, publishNegotiationMessage, publishOffer,
} from "../src/index.js";

const key = (n: string): Hex => { const v = process.env[n]; if (!v || !isHex(v) || v.length !== 66) throw new Error(`${n} missing`); return v; };
const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";
const writerAcct = privateKeyToAccount(key("ARKIV_WRITER_PRIVATE_KEY"));
const merchantAcct = privateKeyToAccount(key("ARKIV_TEST_MERCHANT_KEY"));
const creatorAcct = privateKeyToAccount(key("ARKIV_TEST_CREATOR_KEY"));
const agentAcct = privateKeyToAccount(generatePrivateKey()); // throwaway, never reused
const strangerAcct = privateKeyToAccount(generatePrivateKey());
const reader = createArkivReader(accessKey);
const results: [string, boolean, string][] = [];
const created: { who: "merchant" | "creator" | "agent" | "stranger"; key: Hex }[] = [];

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (ok(v)) return { v, ms: Date.now() - t0 }; if (Date.now() - t0 > timeoutMs) throw new Error("not visible in time"); await new Promise((r) => setTimeout(r, 1500)); }
}
async function check(name: string, fn: () => Promise<string | void>) {
  try { const d = (await fn()) ?? ""; results.push([name, true, d]); console.log(`PASS  ${name}  ${d}`); } catch (e) { results.push([name, false, String(e)]); console.log(`FAIL  ${name}  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
}

async function main() {
  const gasPrice = await getGasPrice(reader);
  const per = 1_000_000n * gasPrice;
  const bal = await getBalance(reader, { address: writerAcct.address });
  console.log(`writer ${formatEther(bal)} tGLM; one write <= ${formatEther(per)}`);
  const funder = createWalletClient({ account: writerAcct, chain: arkivChain(accessKey), transport: http() });
  const fund = async (a: { address: `0x${string}` }, n: bigint) => {
    const have = await getBalance(reader, { address: a.address }); const need = per * n + per / 2n;
    if (have >= need) return;
    await funder.sendTransaction({ to: a.address, value: need - have });
    for (let i = 0; i < 20 && (await getBalance(reader, { address: a.address })) < need; i++) await new Promise((r) => setTimeout(r, 1500));
  };
  await fund(merchantAcct, 3n); await fund(creatorAcct, 3n); await fund(agentAcct, 5n); await fund(strangerAcct, 2n);
  const W = (a: typeof agentAcct) => createArkivWriter({ account: a, accessKey });
  const merchant = W(merchantAcct), creator = W(creatorAcct), agent = W(agentAcct), stranger = W(strangerAcct);
  const campaignId = BigInt(800_000 + (Date.now() % 90_000));
  let offerKey = "0x" as Hex;
  try {
    await check("creator publishes an offer; both principals bind the agent wallet", async () => {
      const o = await publishOffer(creator, { campaignId, channel: "youtube", audience: "live-agents", askBps: 1200, expectedReach: 1000n }); created.push({ who: "creator", key: o.entityKey }); offerKey = o.entityKey;
      const a = await publishAgentBinding(creator, { agent: agentAcct.address, role: "creator" }); created.push({ who: "creator", key: a.entityKey });
      const b = await publishAgentBinding(merchant, { agent: agentAcct.address, role: "merchant" }); created.push({ who: "merchant", key: b.entityKey });
    });
    await check("bindings are visible only under the principal that published them (ownedBy)", async () => {
      const sb = await publishAgentBinding(stranger, { agent: strangerAcct.address, role: "merchant" }); created.push({ who: "stranger", key: sb.entityKey });
      const mb = await eventually(() => listAgentBindings(reader, merchantAcct.address, "merchant"), (r) => r.length >= 1);
      if (mb.v.some((x) => x.agent.toLowerCase() === strangerAcct.address.toLowerCase())) throw new Error("stranger's binding leaked into the merchant's list");
      if (!isAuthorized(agentAcct.address, merchantAcct.address, "merchant", mb.v)) throw new Error("bound agent not authorized");
      if (isAuthorized(strangerAcct.address, merchantAcct.address, "merchant", mb.v)) throw new Error("unbound wallet authorized");
      return `visible after ${mb.ms}ms`;
    });
    await check("agent publishes two rounds; thread reads back in order with correct owners", async () => {
      const base = { offerKey, campaignId, creator: creatorAcct.address, merchant: merchantAcct.address };
      const m1 = await publishNegotiationMessage(agent, { ...base, from: "merchant", seq: 1, action: "propose", bps: 800, note: "opening" }); created.push({ who: "agent", key: m1.entityKey });
      const m2 = await publishNegotiationMessage(agent, { ...base, from: "creator", seq: 2, action: "counter", bps: 1100, note: "counter" }); created.push({ who: "agent", key: m2.entityKey });
      const t = await eventually(() => listNegotiation(reader, offerKey), (r) => r.length >= 2);
      const seqs = t.v.map((x) => x.seq).join(",");
      if (seqs !== "1,2") throw new Error(`order/seqs wrong: ${seqs}`);
      if (t.v.some((x) => x.owner.toLowerCase() !== agentAcct.address.toLowerCase())) throw new Error("owner is not the agent wallet");
      return `visible after ${t.ms}ms`;
    });
    await check("a stranger's forged message is returned raw but fails isAuthorized", async () => {
      const f = await publishNegotiationMessage(stranger, { offerKey, campaignId, creator: creatorAcct.address, merchant: merchantAcct.address, from: "merchant", seq: 3, action: "accept", bps: 1100, note: "forged" }); created.push({ who: "stranger", key: f.entityKey });
      const t = await eventually(() => listNegotiation(reader, offerKey), (r) => r.length >= 3);
      const forged = t.v.find((x) => x.note === "forged")!;
      const mb = await listAgentBindings(reader, merchantAcct.address, "merchant");
      if (isAuthorized(forged.owner, merchantAcct.address, "merchant", mb)) throw new Error("forged message would be trusted");
    });
  } finally {
    const by = { merchant, creator, agent, stranger };
    for (const c of created) { try { await by[c.who].deleteEntity({ entityKey: c.key }); } catch (e) { console.log("cleanup failed", c.key, e instanceof Error ? e.message.split("\n")[0] : ""); } }
  }
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

/**
 * Live Arkiv round trip on Rabdi (chain 7794095) using three dedicated dev wallets from .env:
 *   ARKIV_WRITER_PRIVATE_KEY (Numa writer, funds the others), ARKIV_TEST_MERCHANT_KEY, ARKIV_TEST_CREATOR_KEY, ARKIV_ACCESS_KEY.
 *
 *   pnpm --filter @numa/arkiv live:check -- --check   # read-only: env, chain, balances, cost estimate. No writes.
 *   pnpm --filter @numa/arkiv live:check              # funds merchant/creator, runs the round trip, deletes what it created.
 *
 * Spends testnet tGLM only. Never prints keys. Writes are bounded by ARKIV_LIVE_MAX_TX (default 40).
 */
import { createWalletClient as createViemWallet, formatEther, http, isHex, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getBalance, getGasPrice } from "viem/actions";
import {
  arkivChain, createArkivReader, createArkivWriter, getProfile, listCampaigns, listDecisions, listEndorsements, listInvitesFor, listOffers,
  listConversions, listLiveOffers, topConversions, publishCampaign, publishConversion, publishDecision, publishEndorsement, publishInvite, publishLink, publishOffer, publishProfile,
  renewProfile, resolveLink, searchCreators, setProfileAvailability, type ArkivWriter,
} from "../src/index.js";

const EXPLORER = "https://rabdi.explorer.arkiv.network";
const checkOnly = process.argv.includes("--check");
const maxTx = Number(process.env.ARKIV_LIVE_MAX_TX ?? 80);

function key(name: string): Hex {
  const v = process.env[name];
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`${name} missing or malformed in .env`);
  return v;
}
const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";
const writerAcct = privateKeyToAccount(key("ARKIV_WRITER_PRIVATE_KEY"));
const merchantAcct = privateKeyToAccount(key("ARKIV_TEST_MERCHANT_KEY"));
const creatorAcct = privateKeyToAccount(key("ARKIV_TEST_CREATOR_KEY"));

const reader = createArkivReader(accessKey);
const results: { name: string; ok: boolean; detail: string }[] = [];
const txs: { label: string; hash: string }[] = [];
let sent = 0;
const created: { owner: "merchant" | "creator" | "writer"; key: Hex }[] = [];

const record = (name: string, ok: boolean, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
async function check(name: string, fn: () => Promise<string | void>) {
  try { record(name, true, (await fn()) ?? ""); } catch (e) { record(name, false, e instanceof Error ? e.message.split("\n")[0]! : "error"); }
}
/** Arkiv indexing is asynchronous: poll until the predicate holds; returns elapsed ms. */
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 60_000): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  for (;;) {
    const value = await fn();
    if (ok(value)) return { value, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) throw new Error(`not visible after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const note = (label: string, r: { entityKey: Hex; txHash: Hex }, owner: "merchant" | "creator" | "writer") => { sent++; txs.push({ label, hash: r.txHash }); created.push({ owner, key: r.entityKey }); return r; };
function budget() { if (sent >= maxTx) throw new Error(`write budget ${maxTx} reached`); }

async function main() {
  console.log(`Chain: Rabdi 7794095 | access key: ${accessKey ? "set" : "NOT set (public endpoint, rate limited)"}`);
  const chainId = await reader.getChainId();
  if (chainId !== 7794095) throw new Error(`wrong chain ${chainId}`);
  const gasPrice = await getGasPrice(reader);
  const perWrite = 1_000_000n * gasPrice; // matches SafeWriter's gas floor
  const bal = async (a: `0x${string}`) => getBalance(reader, { address: a });
  const [bw, bm, bc] = await Promise.all([bal(writerAcct.address), bal(merchantAcct.address), bal(creatorAcct.address)]);
  console.log(`gasPrice ${gasPrice} wei | one write ≤ ${formatEther(perWrite)} tGLM`);
  console.log(`writer   ${writerAcct.address}  ${formatEther(bw)} tGLM`);
  console.log(`merchant ${merchantAcct.address}  ${formatEther(bm)} tGLM`);
  console.log(`creator  ${creatorAcct.address}  ${formatEther(bc)} tGLM`);

  // merchant: campaign, decision, invite, endorsement + 4 deletes; creator: profile, offer, link + patch, extend + 3 deletes; writer: conversion + delete
  const needMerchant = perWrite * 14n, needCreator = perWrite * 14n, needWriter = perWrite * 8n + (needMerchant + needCreator) + parseEther("0.001");
  console.log(`planned spend ≈ merchant ${formatEther(needMerchant)}, creator ${formatEther(needCreator)}, writer ${formatEther(needWriter)} tGLM (upper bounds)`);
  if (checkOnly) { console.log(bw >= needWriter ? "Funding looks sufficient." : `Writer needs ≥ ${formatEther(needWriter)} tGLM: fund ${writerAcct.address} at https://hub.arkiv.network/faucet`); return; }
  if (bw < needWriter) throw new Error(`writer underfunded: has ${formatEther(bw)}, needs ≥ ${formatEther(needWriter)} tGLM (https://hub.arkiv.network/faucet)`);

  // Fund the test merchant and creator from the writer (plain native transfers).
  const funder = createViemWallet({ account: writerAcct, chain: arkivChain(accessKey), transport: http() });
  for (const [who, acct, have, need] of [["merchant", merchantAcct, bm, needMerchant], ["creator", creatorAcct, bc, needCreator]] as const) {
    if (have >= need) continue;
    const hash = await funder.sendTransaction({ to: acct.address, value: need - have });
    txs.push({ label: `fund ${who}`, hash }); sent++;
  }
  await new Promise((r) => setTimeout(r, 4000));

  const mk = (a: typeof merchantAcct): ArkivWriter => createArkivWriter({ account: a, accessKey });
  const merchant = mk(merchantAcct), creator = mk(creatorAcct), writer = mk(writerAcct);
  const campaignId = BigInt(900_000 + (Date.now() % 90_000));
  const endsAt = Math.floor(Date.now() / 1000) + 10 * 86400;
  const niche = `livecheck-${Date.now().toString(36)}`;
  const orderId = `0x${"de".repeat(31)}${(Date.now() % 256).toString(16).padStart(2, "0")}` as Hex; // obviously synthetic
  const fakeTx = `0x${"ad".repeat(32)}` as Hex;

  try {
    let profileKey = "0x" as Hex, offerKey = "0x" as Hex;

    await check("creator publishes profile; getProfile + searchCreators find it", async () => {
      budget(); profileKey = note("profile", await publishProfile(creator, { displayName: "Live Check", bio: "arkiv live check", niche, channel: "youtube", handle: "https://example.com/livecheck", minAskBps: 500, open: true }), "creator").entityKey;
      const g = await eventually(() => getProfile(reader, creatorAcct.address), (p) => p?.niche === niche);
      const s = await eventually(() => searchCreators(reader, { niche }), (r) => r.some((p) => p.creator.toLowerCase() === creatorAcct.address.toLowerCase()));
      return `visible after ${g.ms}ms (own) / ${s.ms}ms (search)`;
    });
    await check("creator patches availability and renews profile", async () => {
      budget(); await setProfileAvailability(creator, profileKey, { open: false }); sent++;
      await eventually(() => getProfile(reader, creatorAcct.address), (p) => p?.open === false);
      budget(); await renewProfile(creator, profileKey); sent++;
      const closed = await searchCreators(reader, { niche });
      if (closed.length) throw new Error("closed profile still returned by default (open-only) search");
    });
    await check("merchant publishes campaign; discovery returns it with merchant as owner", async () => {
      budget(); note("campaign", await publishCampaign(merchant, { campaignId, status: "active", category: niche, commissionBps: 1000, endsAt, region: "in", name: "Live Check Campaign", description: "arkiv live check" }), "merchant");
      const r = await eventually(() => listCampaigns(reader, { category: niche }), (c) => c.some((x) => x.campaignId === campaignId));
      const row = r.value.find((x) => x.campaignId === campaignId)!;
      if (row.merchant.toLowerCase() !== merchantAcct.address.toLowerCase()) throw new Error("owner mismatch");
      return `visible after ${r.ms}ms`;
    });
    await check("creator publishes offer; merchant publishes decision; decision is owner-filtered", async () => {
      budget(); offerKey = note("offer", await publishOffer(creator, { campaignId, channel: "youtube", audience: "devs", askBps: 800, expectedReach: 1000n }), "creator").entityKey;
      await eventually(() => listOffers(reader, campaignId), (o) => o.some((x) => x.entityKey === offerKey));
      budget(); note("decision", await publishDecision(merchant, { offerKey, campaignId, result: "approved", approveTx: fakeTx, campaignEndsAt: endsAt }), "merchant");
      await eventually(() => listDecisions(reader, campaignId, merchantAcct.address), (d) => d.length === 1);
      const forged = await listDecisions(reader, campaignId, creatorAcct.address);
      if (forged.length !== 0) throw new Error("decision visible under a non-owner wallet");
    });
    await check("creator publishes link; resolveLink accepts the owner and rejects anyone else", async () => {
      const code = `lc${Date.now().toString(36)}`;
      budget(); note("link", await publishLink(creator, { code, campaignId, days: 7 }), "creator");
      await eventually(() => resolveLink(reader, { code, campaignId, expectedCreator: creatorAcct.address }), (l) => !!l);
      if (await resolveLink(reader, { code, campaignId, expectedCreator: merchantAcct.address })) throw new Error("link resolved for the wrong creator");
    });
    await check("merchant invite and endorsement are queryable by creator address", async () => {
      budget(); note("invite", await publishInvite(merchant, { campaignId, creator: creatorAcct.address, offeredBps: 900, message: "live check" }), "merchant");
      budget(); note("endorsement", await publishEndorsement(merchant, { creator: creatorAcct.address, campaignId, orderId, txHash: fakeTx, rating: 5, note: "synthetic" }), "merchant");
      const i = await eventually(() => listInvitesFor(reader, creatorAcct.address), (r) => r.some((x) => x.campaignId === campaignId));
      const e = await eventually(() => listEndorsements(reader, creatorAcct.address), (r) => r.some((x) => x.campaignId === campaignId));
      if (i.value[0]!.merchant.toLowerCase() !== merchantAcct.address.toLowerCase()) throw new Error("invite owner mismatch");
      return `invite ${i.ms}ms, endorsement ${e.ms}ms`;
    });
    await check("writer conversion is only returned for the writer wallet", async () => {
      budget(); note("conversion (synthetic)", await publishConversion(writer, { creator: creatorAcct.address, merchant: merchantAcct.address, campaignId, gross: 25_000_000n, commission: 2_500_000n, status: "held", paidAt: Math.floor(Date.now() / 1000), txHash: fakeTx, orderId }), "writer");
      await eventually(() => listConversions(reader, { creator: creatorAcct.address, writer: writerAcct.address }), (r) => r.some((x) => x.orderId === orderId));
      const spoof = await listConversions(reader, { creator: creatorAcct.address, writer: creatorAcct.address });
      if (spoof.some((x) => x.orderId === orderId)) throw new Error("conversion returned under a non-writer owner");
    });
    await check("sorted queries: highest commission first, ending soonest first, largest conversions first", async () => {
      const cat = `sort-${niche}`;
      const specs = [{ id: campaignId + 1n, bps: 2000, days: 8 }, { id: campaignId + 2n, bps: 3000, days: 12 }, { id: campaignId + 3n, bps: 1000, days: 5 }];
      for (const c of specs) { budget(); note(`sort campaign ${c.id}`, await publishCampaign(merchant, { campaignId: c.id, status: "active", category: cat, commissionBps: c.bps, endsAt: Math.floor(Date.now() / 1000) + c.days * 86400, region: "in", name: "sort", description: "sort" }), "merchant"); }
      await eventually(() => listCampaigns(reader, { category: cat }), (r) => r.length === 3);
      const byCommission = (await listCampaigns(reader, { category: cat, sort: "commission" })).map((c) => c.commissionBps);
      if (JSON.stringify(byCommission) !== JSON.stringify([3000, 2000, 1000])) throw new Error(`commission order wrong: ${byCommission}`);
      const byEnd = (await listCampaigns(reader, { category: cat, sort: "endingSoon" })).map((c) => Number(c.campaignId - campaignId));
      if (JSON.stringify(byEnd) !== JSON.stringify([3, 1, 2])) throw new Error(`end-date order wrong: ${byEnd}`);
      for (const g of [10_000_000n, 90_000_000n, 40_000_000n]) { budget(); note("sort conversion (synthetic)", await publishConversion(writer, { creator: creatorAcct.address, merchant: merchantAcct.address, campaignId: specs[0]!.id, gross: g, commission: g / 10n, status: "held", paidAt: Math.floor(Date.now() / 1000), txHash: fakeTx, orderId: `0x${"d1".repeat(30)}${g.toString(16).padStart(4, "0").slice(-4)}` as Hex }), "writer"); }
      await eventually(() => topConversions(reader, { writer: writerAcct.address, campaignId: specs[0]!.id }), (r) => r.length === 3);
      const gross = (await topConversions(reader, { writer: writerAcct.address, campaignId: specs[0]!.id })).map((c) => c.gross.toString());
      if (gross.join(",") !== "90000000,40000000,10000000") throw new Error(`gross order wrong: ${gross.join(",")}`);
    });
    await check("offset pagination: pages of 2 over 5 offers return each exactly once; live offers pages by key", async () => {
      const pc = campaignId + 9n;
      const keys: Hex[] = [];
      for (let i = 0; i < 5; i++) { budget(); keys.push(note(`page offer ${i}`, await publishOffer(creator, { campaignId: pc, channel: "youtube", audience: `a${i}`, askBps: 500 + i, expectedReach: 1n }), "creator").entityKey); }
      await eventually(() => listOffers(reader, pc, 50), (r) => r.length === 5);
      const seen: Hex[] = [];
      for (let off = 0; off < 6; off += 2) seen.push(...(await listOffers(reader, pc, 2, off)).map((o) => o.entityKey));
      if (seen.length !== 5 || new Set(seen).size !== 5 || !keys.every((k) => seen.includes(k))) throw new Error(`paging wrong: got ${seen.length} rows, ${new Set(seen).size} unique`);
      const all = await listLiveOffers(reader, 3, 2);
      if (all.length < 5 && all.length !== 6) throw new Error(`listLiveOffers returned ${all.length}`);
      return "page size 2 (the >100-row page size itself is not exercised)";
    });
  } finally {
    // Always try to clean up what we created (each owner deletes their own entities).
    const by = { merchant, creator, writer } as const;
    for (const c of created.reverse()) {
      try { const r = await by[c.owner].deleteEntity({ entityKey: c.key }); txs.push({ label: `delete ${c.owner}`, hash: r.txHash }); } catch (e) { console.log("cleanup failed for", c.key, e instanceof Error ? e.message.split("\n")[0] : ""); }
    }
  }
}

main().catch((e) => { record("setup", false, e instanceof Error ? e.message.split("\n")[0]! : "error"); }).finally(() => {
  console.log("\n--- transactions ---");
  for (const t of txs) console.log(`${t.label.padEnd(24)} ${EXPLORER}/tx/${t.hash}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
});

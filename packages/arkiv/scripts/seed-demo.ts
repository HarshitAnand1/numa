/**
 * Seed Rabdi with clearly-labelled demo marketplace data so discovery screens are not empty on demo day.
 *
 *   pnpm --filter @numa/arkiv seed:demo           # dry run: prints the plan and cost. No writes.
 *   pnpm --filter @numa/arkiv seed:demo -- --yes  # funds derived demo wallets from the writer and publishes.
 *
 * Honesty notes:
 *  - Demo wallets are derived deterministically from ARKIV_WRITER_PRIVATE_KEY (throwaway, hold only tGLM).
 *  - Campaign ids 7001+ do NOT exist in the on-chain CampaignRegistry, so the API reports them with
 *    merchantVerified=null/false. Nothing here fakes a settled sale: no conversions, no reputation scores.
 *  - Idempotent: skips profiles/campaigns that already exist. Spends testnet tGLM only. Never prints keys.
 */
import { createWalletClient, formatEther, http, isHex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getBalance, getGasPrice } from "viem/actions";
import { arkivChain, createArkivReader, createArkivWriter, getProfile, listCampaigns, publishCampaign, publishOffer, publishProfile } from "../src/index.js";

const yes = process.argv.includes("--yes");
const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";
const raw = process.env.ARKIV_WRITER_PRIVATE_KEY;
if (!raw || !isHex(raw) || raw.length !== 66) throw new Error("ARKIV_WRITER_PRIVATE_KEY missing or malformed in .env");
const writerAcct = privateKeyToAccount(raw);
const derive = (label: string) => privateKeyToAccount(keccak256(toHex(`${raw}:numa-demo-seed:${label}`)));

const DAY = 86400, now = Math.floor(Date.now() / 1000);
const merchants = [
  { id: "m1", campaigns: [
    { campaignId: 7001n, name: "[DEMO] Pixel Pro Headphones", description: "Demo campaign. Wireless headphones, USDT checkout.", category: "tech", commissionBps: 1500, region: "global", days: 40 },
    { campaignId: 7002n, name: "[DEMO] Pixel Pro Case", description: "Demo campaign. Protective case bundle.", category: "tech", commissionBps: 1000, region: "global", days: 12 },
  ] },
  { id: "m2", campaigns: [
    { campaignId: 7003n, name: "[DEMO] Lumen Skincare Set", description: "Demo campaign. Cruelty-free skincare set.", category: "beauty", commissionBps: 2000, region: "in", days: 25 },
  ] },
  { id: "m3", campaigns: [
    { campaignId: 7004n, name: "[DEMO] Dev Bootcamp Pass", description: "Demo campaign. Web3 developer bootcamp seat.", category: "education", commissionBps: 2500, region: "global", days: 60 },
  ] },
];
const creators = [
  { id: "c1", displayName: "[DEMO] Aarav Tech", bio: "Demo profile. Gadget reviews.", niche: "tech", channel: "youtube", handle: "https://example.com/demo/aarav", minAskBps: 800, offer: { campaignId: 7001n, askBps: 1200, expectedReach: 40000n, audience: "gadget buyers 18-35" } },
  { id: "c2", displayName: "[DEMO] Meera Glow", bio: "Demo profile. Skincare routines.", niche: "beauty", channel: "instagram", handle: "https://example.com/demo/meera", minAskBps: 1000, offer: { campaignId: 7003n, askBps: 1800, expectedReach: 25000n, audience: "skincare, India" } },
  { id: "c3", displayName: "[DEMO] Kai Builds", bio: "Demo profile. Web3 dev tutorials.", niche: "education", channel: "youtube", handle: "https://example.com/demo/kai", minAskBps: 1500, offer: { campaignId: 7004n, askBps: 2200, expectedReach: 15000n, audience: "aspiring devs" } },
  { id: "c4", displayName: "[DEMO] Zoe Reviews", bio: "Demo profile. Mobile accessories.", niche: "tech", channel: "twitter", handle: "https://example.com/demo/zoe", minAskBps: 600, offer: { campaignId: 7002n, askBps: 900, expectedReach: 9000n, audience: "mobile users" } },
];

async function main() {
  const reader = createArkivReader(accessKey);
  const gasPrice = await getGasPrice(reader);
  const perWrite = 1_000_000n * gasPrice;
  const writes = merchants.reduce((n, m) => n + m.campaigns.length, 0) + creators.length * 2;
  const perWallet = (n: bigint) => perWrite * n + perWrite / 2n;
  const fundTotal = merchants.reduce((s, m) => s + perWallet(BigInt(m.campaigns.length)), 0n) + BigInt(creators.length) * perWallet(2n);
  const bal = await getBalance(reader, { address: writerAcct.address });
  console.log(`writer ${writerAcct.address} holds ${formatEther(bal)} tGLM`);
  console.log(`plan: ${merchants.length} merchants, ${creators.length} creators, ${writes} writes; funding ≤ ${formatEther(fundTotal)} tGLM (upper bound)`);
  if (!yes) { console.log("dry run. Re-run with --yes to write."); return; }
  if (bal < fundTotal + perWrite * 4n) throw new Error(`writer underfunded: needs ≥ ${formatEther(fundTotal + perWrite * 4n)} tGLM (https://hub.arkiv.network/faucet)`);

  const funder = createWalletClient({ account: writerAcct, chain: arkivChain(accessKey), transport: http() });
  const ensureFunds = async (acct: ReturnType<typeof derive>, need: bigint) => {
    const have = await getBalance(reader, { address: acct.address });
    if (have >= need) return;
    await funder.sendTransaction({ to: acct.address, value: need - have });
    for (let i = 0; i < 20 && (await getBalance(reader, { address: acct.address })) < need; i++) await new Promise((r) => setTimeout(r, 1500));
  };

  let wrote = 0, skipped = 0;
  for (const m of merchants) {
    const acct = derive(m.id);
    const existing = await listCampaigns(reader, { limit: 100 }, now);
    const todo = m.campaigns.filter((c) => !existing.some((e) => e.campaignId === c.campaignId && e.merchant.toLowerCase() === acct.address.toLowerCase()));
    skipped += m.campaigns.length - todo.length;
    if (!todo.length) continue;
    await ensureFunds(acct, perWallet(BigInt(todo.length)));
    const w = createArkivWriter({ account: acct, accessKey });
    for (const c of todo) {
      await publishCampaign(w, { campaignId: c.campaignId, status: "active", category: c.category, commissionBps: c.commissionBps, endsAt: now + c.days * DAY, region: c.region, name: c.name, description: c.description });
      wrote++; console.log(`campaign ${c.campaignId} ${c.name}`);
    }
  }
  for (const c of creators) {
    const acct = derive(c.id);
    if (await getProfile(reader, acct.address)) { skipped += 2; console.log(`skip ${c.displayName} (exists)`); continue; }
    await ensureFunds(acct, perWallet(2n));
    const w = createArkivWriter({ account: acct, accessKey });
    await publishProfile(w, { displayName: c.displayName, bio: c.bio, niche: c.niche, channel: c.channel, handle: c.handle, minAskBps: c.minAskBps, open: true });
    await publishOffer(w, { campaignId: c.offer.campaignId, channel: c.channel, audience: c.offer.audience, askBps: c.offer.askBps, expectedReach: c.offer.expectedReach });
    wrote += 2; console.log(`creator ${c.displayName} + offer on ${c.offer.campaignId}`);
  }
  console.log(`done: ${wrote} entities written, ${skipped} skipped`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
export {};

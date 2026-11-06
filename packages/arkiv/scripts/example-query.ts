/**
 * Read-only example query for judges/users. No key needed (an ARKIV_ACCESS_KEY avoids rate limits).
 *   pnpm --filter @numa/arkiv query:example
 * Lists live Numa campaigns (highest commission first), open creators for a niche, and live offers per campaign,
 * then prints each entity's owner wallet, because ownership is the trust anchor.
 */
import { createArkivReader, listCampaigns, listLiveOffers, searchCreators } from "../src/index.js";

const reader = createArkivReader(process.env.ARKIV_ACCESS_KEY ?? "");
const now = Math.floor(Date.now() / 1000);
const campaigns = await listCampaigns(reader, { sort: "commission", limit: 20 }, now);
console.log(`live campaigns: ${campaigns.length}`);
for (const c of campaigns) console.log(`  #${c.campaignId} ${c.name} | ${c.category} | ${Number(c.commissionBps) / 100}% | owner ${c.merchant}`);
const creators = await searchCreators(reader, { niche: process.argv[2] ?? "tech" });
console.log(`open creators (niche=${process.argv[2] ?? "tech"}): ${creators.length}`);
for (const p of creators) console.log(`  ${p.displayName} | ${p.channel} | min ${Number(p.minAskBps) / 100}% | owner ${p.creator}`);
const offers = await listLiveOffers(reader);
console.log(`live offers: ${offers.length}`);
export {};

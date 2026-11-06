/**
 * Demo: "500 fake clicks, $0 paid".
 *   pnpm --filter @numa/api demo:fake-clicks -- --code mylink01 [--n 500] [--base http://localhost:8787] [--creator 0x.. --campaign 7]
 * Sends N bot-style clicks to /r/<code>, then prints the link's stats. Clicks are real HTTP requests to the real tracker;
 * the point is that the stats show clicks next to verified settled sales — and only the latter produce commission.
 * Nothing here touches the chain or fabricates any payment.
 */
const arg = (name: string, d?: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : d; };
const base = (arg("base", "http://localhost:8787") as string).replace(/\/$/, "");
const code = arg("code");
const n = Number(arg("n", "500"));
const creator = arg("creator");
const campaign = arg("campaign");
if (!code) { console.error("usage: --code <link code> [--n 500] [--base URL] [--creator 0x.. --campaign <id>]"); process.exit(2); }

const agents = Array.from({ length: 25 }, (_, i) => `bot-${i}/1.0 (+demo)`);
let ok = 0, failed = 0;
const t0 = Date.now();
async function worker(start: number, step: number) {
  for (let i = start; i < n; i += step) {
    try {
      const r = await fetch(`${base}/r/${encodeURIComponent(code!)}`, { redirect: "manual", headers: { "user-agent": agents[i % agents.length]! } });
      if (r.status === 302) ok++; else failed++;
    } catch { failed++; }
  }
}
await Promise.all(Array.from({ length: 20 }, (_, w) => worker(w, 20)));
console.log(`sent ${n} clicks in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${ok} redirected, ${failed} failed`);

const qs = creator && campaign ? `?creator=${creator}&campaignId=${campaign}` : "";
const stats = await (await fetch(`${base}/links/${encodeURIComponent(code)}/stats${qs}`)).json() as Record<string, unknown>;
console.log("\nlink stats:", JSON.stringify(stats, null, 2));
const s = stats.settled as { verifiedConversions: number; commissionEarned: string } | null;
if (s) console.log(`\n=> ${stats.clicks} clicks, ${s.verifiedConversions} verified sales, commission earned: ${s.commissionEarned} (USDT base units)`);
else console.log("\n=> pass --creator and --campaign (with Arkiv configured) to show verified sales next to the clicks");
export {};

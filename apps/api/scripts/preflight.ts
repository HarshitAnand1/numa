/**
 * Read-only deploy-day check. Fill `.env` (router, registry, relayer key...) then:
 *   pnpm --filter @numa/api preflight            # or: -- --campaign 1  to also check the demo merchant signer
 * Exits 1 if any check fails. Sends no transactions and never prints keys.
 */
import { createPublicClient, http } from "viem";
import { whitechainSepolia } from "@numa/shared";
import { loadEnv } from "../src/config/env.js";
import { runPreflight, summarize } from "../src/preflight.js";

const i = process.argv.indexOf("--campaign");
const env = loadEnv();
const pub = createPublicClient({ chain: { ...whitechainSepolia, id: env.WHITECHAIN_CHAIN_ID }, transport: http(env.WHITECHAIN_RPC_URL) });
const checks = await runPreflight(env, pub, i > -1 ? { campaignId: BigInt(process.argv[i + 1]!) } : {});
const icon = { ok: "PASS", warn: "WARN", fail: "FAIL" } as const;
for (const c of checks) console.log(`${icon[c.level]}  ${c.name}  ${c.detail}`);
const s = summarize(checks);
console.log(`\n${checks.length - s.failed - s.warned} ok, ${s.warned} warnings, ${s.failed} failures`);
process.exit(s.failed ? 1 : 0);

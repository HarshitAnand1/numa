import { isAddress } from "viem";
import { z } from "zod";

const addr = z.string().refine(isAddress, "invalid address").transform((v) => v as `0x${string}`);
const key = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x + 64 hex");

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  /** Postgres for relayer limits + indexer cursor. Falls back to in-memory (lost on restart) when unset. */
  DATABASE_URL: z.string().url().optional(),
  WHITECHAIN_RPC_URL: z.string().url().refine((u) => u.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u), "RPC must be https (plain http only for a local node)"),
  WHITECHAIN_CHAIN_ID: z.coerce.number().default(1874),
  NUMA_ROUTER_ADDRESS: addr,
  /** CampaignRegistry address. Required: the relayer reads `getCampaign(campaignId).commissionBps`
   * from here to independently recompute the expected OrderCommitment (see
   * docs/DECISIONS/0005-order-commitment-nonce-binding.md) - it never trusts a caller-supplied
   * nonce. Also lets the API verify that Arkiv campaigns/invites come from the on-chain merchant. */
  CAMPAIGN_REGISTRY_ADDRESS: addr,
  RELAYER_PRIVATE_KEY: key,
  MERCHANT_SIGNER_KEY: key.optional(),
  RELAYER_MAX_GAS_PRICE_GWEI: z.coerce.number().positive(),
  /** Max gas spend per UTC day, in WBT */
  RELAYER_DAILY_CAP_WBT: z.coerce.number().positive(),
  RELAYER_PER_ADDRESS_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  /** Arkiv writer wallet for conversion entities (needs tGLM). Indexer + reputation are disabled without it. */
  ARKIV_WRITER_PRIVATE_KEY: key.optional(),
  ARKIV_ACCESS_KEY: z.string().default(""),
  INDEXER_START_BLOCK: z.coerce.bigint().default(0n),
  KEEPER_POLL_MS: z.coerce.number().int().positive().default(30_000),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(5000),
  CHECKOUT_BASE_URL: z.string().url().default("http://localhost:3000"),
  CLICK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(3000),
  /** Mixed into click visitor hashes; set any random string in production. */
  CLICK_VISITOR_SECRET: z.string().default("dev-only-change-me"),
  /** Comma-separated allowed browser origins for CORS (e.g. https://numa.app). "*" allows any. Empty = no CORS headers. */
  CORS_ORIGINS: z.string().default(""),
  /** Max ms for a discovery request before it returns 504 instead of hanging on Arkiv. */
  DISCOVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Negotiation agent wallet (writes Arkiv entities only; needs tGLM). Agents are off without it. */
  AGENT_WALLET_PRIVATE_KEY: key.optional(),
  AGENT_POLL_MS: z.coerce.number().int().min(5000).default(15_000),
  /** Optional: when set, Claude phrases agent notes. Decisions never depend on it. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_LLM_MODEL: z.string().default("claude-opus-5-5"),
  /** Optional: Google Gemini phrases agent notes instead (it has a free tier). Preferred over Anthropic when both are set. */
  GEMINI_API_KEY: z.string().optional(),
  /** A model with a free tier (check Google's pricing page; model names change). */
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  /** Which model phrases notes. auto = Gemini if its key is set, else Claude if its key is set, else templates. */
  AGENT_LLM_PROVIDER: z.enum(["auto", "gemini", "anthropic", "none"]).default("auto"),
  ORDER_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});
export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // A blank value (`FOO=` as shipped in .env.example) means "not set": optional settings stay off and defaults apply.
  const r = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== "")));
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return r.data;
}

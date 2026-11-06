import { isAddress } from "viem";
import { z } from "zod";

const addr = z.string().refine(isAddress, "invalid address").transform((v) => v as `0x${string}`);
const key = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x + 64 hex");

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  /** Postgres for relayer limits + indexer cursor. Falls back to in-memory (lost on restart) when unset. */
  DATABASE_URL: z.string().url().optional(),
  WHITECHAIN_RPC_URL: z.string().url().refine((u) => u.startsWith("https://"), "RPC must be https"),
  WHITECHAIN_CHAIN_ID: z.coerce.number().default(1874),
  NUMA_ROUTER_ADDRESS: addr,
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
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(5000),
  ORDER_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});
export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return r.data;
}

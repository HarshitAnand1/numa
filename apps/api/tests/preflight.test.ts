import { describe, expect, it } from "vitest";
import { hashDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS } from "@numa/shared";
import { loadEnv } from "../src/config/env.js";
import { runPreflight, summarize } from "../src/preflight.js";

const REG = "0x2222222222222222222222222222222222222222", ROUTER = "0x1111111111111111111111111111111111111111";
const RELAYER_KEY = `0x${"11".repeat(32)}`, SIGNER_KEY = `0x${"22".repeat(32)}`;
const env = (o: Record<string, string> = {}) => loadEnv({
  WHITECHAIN_RPC_URL: "https://rpc.testnet.whitechain.io", NUMA_ROUTER_ADDRESS: ROUTER, CAMPAIGN_REGISTRY_ADDRESS: REG, RELAYER_PRIVATE_KEY: RELAYER_KEY,
  MERCHANT_SIGNER_KEY: SIGNER_KEY, RELAYER_MAX_GAS_PRICE_GWEI: "5", RELAYER_DAILY_CAP_WBT: "1", DATABASE_URL: "postgres://x:y@localhost/z", CORS_ORIGINS: "*", ARKIV_WRITER_PRIVATE_KEY: `0x${"33".repeat(32)}`, ...o,
});
const domain = hashDomain({ domain: { name: "Tether USD", version: "1", chainId: 1874n, verifyingContract: USDT_ADDRESS }, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } });

interface Chain { chainId?: number; code?: string; registry?: string; usdt?: string; fee?: bigint; window?: bigint; sep?: string; balance?: bigint; gasPrice?: bigint; payout?: string; exists?: boolean }
const pub = (c: Chain = {}) => ({
  getChainId: async () => c.chainId ?? 1874,
  getCode: async () => c.code ?? "0x6001",
  getBalance: async () => c.balance ?? 5n * 10n ** 18n,
  getGasPrice: async () => c.gasPrice ?? 1_000_000_000n,
  readContract: async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "registry": return c.registry ?? REG;
      case "usdt": return c.usdt ?? USDT_ADDRESS;
      case "feeBps": return c.fee ?? 50n;
      case "refundWindow": return c.window ?? 60n;
      case "DOMAIN_SEPARATOR": return c.sep ?? domain;
      case "getCampaign": return { exists: c.exists ?? true, payoutSigner: c.payout ?? privateKeyToAccount(SIGNER_KEY as `0x${string}`).address };
      default: throw new Error(`unexpected ${functionName}`);
    }
  },
}) as never;
const level = (checks: Awaited<ReturnType<typeof runPreflight>>, part: string) => checks.find((x) => x.name.includes(part))?.level;

describe("preflight", () => {
  it("a correct deployment passes with no failures or warnings", async () => {
    const checks = await runPreflight(env(), pub(), { campaignId: 1n });
    expect(summarize(checks)).toEqual({ failed: 0, warned: 0 });
  });
  it("catches the mistakes that would break deploy day", async () => {
    const f = async (c: Chain, o: Record<string, string> = {}) => runPreflight(env(o), pub(c), { campaignId: 1n });
    expect(level(await f({ chainId: 1 }), "expected chain")).toBe("fail");
    expect(level(await f({ code: "0x" }), "NumaRouter has contract code")).toBe("fail");
    expect(level(await f({ registry: "0x3333333333333333333333333333333333333333" }), "wired")).toBe("fail");
    expect(level(await f({ usdt: "0x3333333333333333333333333333333333333333" }), "wired")).toBe("fail"); // a self-minted token must not pass
    expect(level(await f({ sep: `0x${"00".repeat(32)}` }), "EIP-712 domain")).toBe("fail");
    expect(level(await f({ balance: 0n }), "relayer wallet")).toBe("fail");
    expect(level(await f({ gasPrice: 50_000_000_000n }), "relayer wallet")).toBe("fail"); // above the ceiling: every relay refused
    expect(level(await f({ balance: 10n ** 17n }), "relayer wallet")).toBe("warn"); // below the daily cap
    expect(level(await f({ payout: "0x3333333333333333333333333333333333333333" }), "payout signer")).toBe("fail");
    expect(level(await f({ exists: false }), "payout signer")).toBe("fail");
    expect(level(await f({ window: 86_400n }), "refund window")).toBe("warn");
  });
  it("warns about optional-but-important config and never throws on an RPC error", async () => {
    const bare = await runPreflight(env({ DATABASE_URL: "", CORS_ORIGINS: "", ARKIV_WRITER_PRIVATE_KEY: "" } as never), pub());
    expect(["Postgres", "CORS", "Arkiv writer"].map((n) => level(bare, n))).toEqual(["warn", "warn", "warn"]);
    const broken = { getChainId: async () => { throw new Error("connect ECONNREFUSED"); }, getCode: async () => { throw new Error("x"); }, getBalance: async () => { throw new Error("x"); }, getGasPrice: async () => { throw new Error("x"); }, readContract: async () => { throw new Error("x"); } } as never;
    const checks = await runPreflight(env(), broken, { campaignId: 1n });
    expect(summarize(checks).failed).toBeGreaterThan(3);
  });
});

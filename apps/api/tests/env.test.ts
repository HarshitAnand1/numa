import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const valid = {
  NUMA_ROUTER_ADDRESS: "0x1111111111111111111111111111111111111111", CAMPAIGN_REGISTRY_ADDRESS: "0x2222222222222222222222222222222222222222",
  RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`, RELAYER_MAX_GAS_PRICE_GWEI: "5", RELAYER_DAILY_CAP_WBT: "1",
};

describe("loadEnv", () => {
  it("treats blank values (as shipped in .env.example) as unset: optional features stay off and defaults apply", () => {
    const e = loadEnv({ ...valid, WHITECHAIN_RPC_URL: "https://rpc.testnet.whitechain.io", MERCHANT_SIGNER_KEY: "", ARKIV_WRITER_PRIVATE_KEY: "", AGENT_WALLET_PRIVATE_KEY: "", ANTHROPIC_API_KEY: "", CORS_ORIGINS: "", CLICK_VISITOR_SECRET: "", DATABASE_URL: "" });
    expect(e.MERCHANT_SIGNER_KEY).toBeUndefined();
    expect(e.ARKIV_WRITER_PRIVATE_KEY).toBeUndefined();
    expect(e.CLICK_VISITOR_SECRET).toBe("dev-only-change-me");
  });
  it("still requires the mandatory values when they are blank", () => {
    expect(() => loadEnv({ ...valid, WHITECHAIN_RPC_URL: "https://rpc.testnet.whitechain.io", RELAYER_PRIVATE_KEY: "" })).toThrow(/RELAYER_PRIVATE_KEY/);
  });
  it("rejects http RPC and bad keys", () => {
    expect(() => loadEnv({ WHITECHAIN_RPC_URL: "http://x.io" })).toThrow(/Invalid environment/);
  });
  it("accepts https, accepts plain http only for a local node, rejects look-alike hosts", () => {
    expect(loadEnv({ ...valid, WHITECHAIN_RPC_URL: "https://rpc.testnet.whitechain.io" }).WHITECHAIN_RPC_URL).toMatch(/^https/);
    expect(loadEnv({ ...valid, WHITECHAIN_RPC_URL: "http://127.0.0.1:8545" }).WHITECHAIN_RPC_URL).toBe("http://127.0.0.1:8545");
    expect(loadEnv({ ...valid, WHITECHAIN_RPC_URL: "http://localhost:8545" }).WHITECHAIN_RPC_URL).toBe("http://localhost:8545");
    expect(() => loadEnv({ ...valid, WHITECHAIN_RPC_URL: "http://localhost.evil.com:8545" })).toThrow(/Invalid environment/);
    expect(() => loadEnv({ ...valid, WHITECHAIN_RPC_URL: "http://127.0.0.1.evil.com" })).toThrow(/Invalid environment/);
  });
});

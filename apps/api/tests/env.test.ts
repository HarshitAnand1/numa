import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

describe("loadEnv", () => {
  it("rejects http RPC and bad keys", () => {
    expect(() => loadEnv({ WHITECHAIN_RPC_URL: "http://x.io" })).toThrow(/Invalid environment/);
  });
});

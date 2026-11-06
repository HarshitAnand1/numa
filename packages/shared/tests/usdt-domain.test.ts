import { describe, expect, it } from "vitest";
import { hashDomain } from "viem";
import { receiveAuthTypedData } from "../src/index.js";

// DOMAIN_SEPARATOR() read from the Whitechain Sepolia USDT proxy (cast call, 2026-11-06).
const ONCHAIN_DOMAIN_SEPARATOR = "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25";

describe("USDT EIP-712 domain", () => {
  it("receiveAuthTypedData's domain hashes to the token's on-chain DOMAIN_SEPARATOR", () => {
    const t = receiveAuthTypedData({
      from: "0x0000000000000000000000000000000000000001", router: "0x0000000000000000000000000000000000000002",
      value: 1n, validAfter: 0n, validBefore: 1n, nonce: `0x${"00".repeat(32)}`,
    }, 1874);
    expect(hashDomain({ domain: { ...t.domain, chainId: BigInt(t.domain.chainId) }, types: { EIP712Domain: [
      { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
    ] } })).toBe(ONCHAIN_DOMAIN_SEPARATOR);
  });
});
